from fastapi import (
    FastAPI, Request, Form, File,
    UploadFile, HTTPException
)
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
import csv
import io
import time # For timing the analysis
from contextlib import asynccontextmanager
import traceback # For error logging
import os

# --- Hugging Face Imports ---
import torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification

# --- NLTK Imports (for Top Words) ---
import nltk
from nltk.corpus import stopwords
from nltk.tokenize import word_tokenize
from collections import Counter
import re # For removing punctuation
import nltk.downloader
from urllib.error import URLError

# --- Model Name ---
MODEL_NAME = "cardiffnlp/twitter-roberta-base-sentiment-latest"

# --- Global Variables ---
vader_analyzer = None
hf_tokenizer = None
hf_model = None
nltk_stopwords = None
nltk_punkt_downloaded = False

# --- LIFESPAN EVENT ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    global vader_analyzer, hf_tokenizer, hf_model, nltk_stopwords, nltk_punkt_downloaded
    print("Server starting up...")
    print("Warming up VADER model...")
    vader_analyzer = SentimentIntensityAnalyzer()
    print("Checking/Downloading NLTK data...")
    nltk_data_path = os.path.expanduser('~/nltk_data'); os.makedirs(nltk_data_path, exist_ok=True)
    if nltk_data_path not in nltk.data.path: nltk.data.path.append(nltk_data_path)
    nltk_download_list = ['punkt', 'stopwords', 'punkt_tab']
    for item in nltk_download_list:
        try:
            print(f"- Checking NLTK: {item}..."); nltk.data.find(f'tokenizers/{item}' if item.startswith('punkt') else f'corpora/{item}')
            print(f"- Found: {item}.")
            if item == 'punkt': nltk_punkt_downloaded = True
            if item == 'stopwords': nltk_stopwords = set(stopwords.words('english'))
        except LookupError:
            print(f"- Downloading NLTK: {item}...");
            try:
                nltk.download(item, download_dir=nltk_data_path, quiet=False)
                nltk.data.find(f'tokenizers/{item}' if item.startswith('punkt') else f'corpora/{item}')
                print(f"- Download OK: {item}.")
                if item == 'punkt': nltk_punkt_downloaded = True
                if item == 'stopwords': nltk_stopwords = set(stopwords.words('english'))
            except Exception as e: print(f"ERROR downloading NLTK '{item}': {e}"); print("Top words may fail."); nltk_stopwords = nltk_stopwords if item != 'stopwords' else set() # Fallback
    if nltk_stopwords is None: print("Warning: Stopwords load failed."); nltk_stopwords = set()
    print(f"Warming up Hugging Face model: {MODEL_NAME}..."); print("May take 2-5 min...")
    try: hf_tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME); hf_model = AutoModelForSequenceClassification.from_pretrained(MODEL_NAME); print("HF model loaded.")
    except Exception as e: print(f"FATAL: Failed HF model load: {e}")
    print("Startup sequence complete.")
    yield
    print("Server shutting down...")

# --- App Setup ---
app = FastAPI(lifespan=lifespan)
app.mount("/static", StaticFiles(directory="static"), name="static")
class TextInput(BaseModel): text: str

# --- Helpers ---
def get_csv_preview(content: bytes):
    preview_data = []
    try: decoded_content = content.decode('utf-8', errors='ignore')
    except Exception:
        try: decoded_content = content.decode('latin-1', errors='ignore')
        except Exception: return [['Error reading preview']]
    reader = csv.reader(io.StringIO(decoded_content))
    try:
        header = next(reader)
        preview_data.append(header)
        for i, row in enumerate(reader):
            if i >= 5: break
            preview_data.append([str(cell)[:100] + ('...' if len(str(cell)) > 100 else '') for cell in row])
        return preview_data
    except StopIteration: return [header] if 'header' in locals() and header else [['File empty']]
    except csv.Error as e: print(f"CSV Preview Error: {e}"); return [['Error parsing preview']]
    except Exception as e: print(f"Preview Error: {e}"); return [['Error reading preview']]

def analyze_huggingface_text(text: str):
    if not hf_tokenizer or not hf_model: raise RuntimeError("HF models not loaded.")
    if not isinstance(text, str): text = str(text)
    text = text.replace('\n', ' ').replace('\r', '').strip()
    if not text: return {"sentiment": "Neutral", "score": 0.5, "chart_data": {'Negative': 0.0, 'Neutral': 1.0, 'Positive': 0.0}}
    inputs = hf_tokenizer(text, return_tensors='pt', truncation=True, max_length=512, padding=True)
    with torch.no_grad(): outputs = hf_model(**inputs)
    logits = outputs.logits; scores = torch.softmax(logits, dim=1).tolist()[0]
    label_id = torch.argmax(logits, dim=1).item()
    sentiment = hf_model.config.id2label.get(label_id, "Unknown")
    score = scores[label_id] if 0 <= label_id < len(scores) else 0.0
    chart_data = {hf_model.config.id2label.get(i, f"L_{i}"): s for i, s in enumerate(scores)}
    expected = ["Negative", "Neutral", "Positive"]; [chart_data.setdefault(l, 0.0) for l in expected]
    return {"sentiment": sentiment, "score": score, "chart_data": chart_data}

def get_top_words(text: str, num_words: int = 10):
    if not nltk_punkt_downloaded: return ["Error: NLTK tokenizer missing."]
    current_stopwords = nltk_stopwords if nltk_stopwords is not None else set()
    if not isinstance(text, str) or not text.strip(): return []
    try:
        text_processed = re.sub(r'[^\w\s-]', '', text.lower())
        try: tokens = word_tokenize(text_processed)
        except LookupError as e: return [f"Error: NLTK data missing ('{e}')."]
        except Exception as e: return ["Error tokenizing text."]
        filtered_tokens = [ w for w in tokens if w.isalpha() and w not in current_stopwords and len(w) > 2 ]
        if not filtered_tokens: return ["No significant keywords found."]
        word_counts = Counter(filtered_tokens)
        return [word for word, count in word_counts.most_common(num_words)]
    except Exception as e: print(f"Top words error: {e}"); traceback.print_exc(); return ["Error processing keywords."]

async def handle_analysis_error(e: Exception):
    print("="*20 + " ANALYSIS ERROR " + "="*20); traceback.print_exc(); print("="*56)
    status_code = 500; detail = f"Internal Server Error: {type(e).__name__}."
    if isinstance(e, HTTPException): status_code = e.status_code; detail = e.detail
    elif isinstance(e, MemoryError): detail = "Processing Error: Server ran out of memory."
    elif isinstance(e, RuntimeError) and "models are not loaded" in str(e): detail = "Server Error: Models failed to load."
    elif isinstance(e, UnicodeDecodeError): detail = "File Encoding Error."; status_code = 400
    elif isinstance(e, csv.Error): detail = f"CSV Parsing Error: {e}"; status_code = 400
    elif isinstance(e, LookupError): detail = f"Server Config Error: NLTK data missing ('{e}')."; status_code=500
    return JSONResponse(status_code=status_code, content={"detail": detail})

# --- ENDPOINT 1: VADER ANALYSIS ---
@app.post("/analyze-vader/")
async def analyze_vader(text_input: str = Form(None), file_input: UploadFile = File(None)):
    start_time = time.time()
    full_text_for_top_words = ""
    try:
        if not vader_analyzer: raise RuntimeError("VADER model failed.")
        if not text_input and not file_input: raise HTTPException(status_code=400, detail="No input.")
        preview_data = None; analysis_result = None
        if file_input:
            contents = await file_input.read()
            if not contents: raise HTTPException(status_code=400, detail="File empty.")
            filename = file_input.filename or "file"
            try: full_text_for_top_words = contents.decode('utf-8', errors='ignore')
            except Exception: full_text_for_top_words = contents.decode('latin-1', errors='ignore')
            if filename.endswith('.txt'): analysis_result = analyze_vader_text(full_text_for_top_words, start_time, preview=None)
            elif filename.endswith('.csv'): preview_data = get_csv_preview(contents); analysis_result = analyze_vader_csv(contents, start_time, preview_data) # Limit is inside
            else: raise HTTPException(status_code=400, detail="Use .txt or .csv.")
        elif text_input: full_text_for_top_words = text_input; analysis_result = analyze_vader_text(text_input, start_time, preview=None)
        if analysis_result: analysis_result["top_words"] = get_top_words(full_text_for_top_words)
        else: raise HTTPException(status_code=500, detail="Analysis failed.")
        return analysis_result
    except Exception as e: return await handle_analysis_error(e)

def analyze_vader_text(text: str, start_time: float, preview: list | None):
    if not isinstance(text, str): text = str(text)
    text_cleaned = text.replace('\n', ' ').replace('\r', '').strip()
    if not text_cleaned: sentiment="Neutral"; compound=0.0; scores={'pos':0.0, 'neg':0.0, 'neu':1.0, 'compound':0.0}
    else: scores = vader_analyzer.polarity_scores(text_cleaned); compound = scores['compound']; sentiment = "Positive" if compound > 0.05 else ("Negative" if compound < -0.05 else "Neutral")
    chart_data = {'Positive': scores.get('pos',0.0), 'Negative': scores.get('neg',0.0), 'Neutral': scores.get('neu',1.0 if not text_cleaned else 0.0), 'Compound': scores.get('compound',0.0)}
    end_time = time.time()
    return {"analysis_type":"text", "model":"VADER", "sentiment":sentiment, "score":compound, "chart_data":chart_data, "execution_time":round(end_time-start_time, 4), "preview_data":preview}

def analyze_vader_csv(contents: bytes, start_time: float, preview: list | None):
    counts = {"Positive": 0, "Negative": 0, "Neutral": 0}
    limit_info = None # For limit message
    try: decoded_content = contents.decode('utf-8', errors='ignore')
    except Exception: decoded_content = contents.decode('latin-1', errors='ignore')
    reader = csv.DictReader(io.StringIO(decoded_content))
    review_col = None; fieldnames_lower = {f.lower():f for f in reader.fieldnames or []}
    if not fieldnames_lower: raise HTTPException(status_code=400, detail="CSV empty/no header.")
    for name_lower in ["reviewtext", "review", "text"]:
        if name_lower in fieldnames_lower: review_col = fieldnames_lower[name_lower]; break
    if not review_col: raise HTTPException(status_code=400, detail=f"Review column not found. Header: {reader.fieldnames}")

    reviews_processed = 0
    # --- VADER LIMIT SET TO 50 ---
    MAX_ROWS_VADER = 50 
    limit_reached = False

    for i, row in enumerate(reader):
        if i >= MAX_ROWS_VADER:
            print(f"INFO: VADER CSV processing stopped after {MAX_ROWS_VADER} rows due to limit.")
            limit_info = f"Analysis limited to the first {MAX_ROWS_VADER} rows for comparison consistency."
            limit_reached = True
            break # Stop processing

        try:
            text = row.get(review_col)
            if text:
                if not isinstance(text, str): text = str(text)
                text_cleaned = text.replace('\n', ' ').replace('\r', '').strip()
                if text_cleaned:
                    compound = vader_analyzer.polarity_scores(text_cleaned)['compound']
                    if compound > 0.05: counts["Positive"] += 1
                    elif compound < -0.05: counts["Negative"] += 1
                    else: counts["Neutral"] += 1
                    reviews_processed += 1
        except Exception as e: print(f"Warn: VADER CSV row {i+1} error: {e}. Skipping."); continue

    if reviews_processed == 0 and not limit_reached:
         try: reader_check = csv.DictReader(io.StringIO(decoded_content)); _=next(reader_check); _=next(reader_check); raise HTTPException(status_code=400, detail="No valid reviews processed.")
         except StopIteration: raise HTTPException(status_code=400, detail="CSV has no data rows.")
         except Exception: raise HTTPException(status_code=400, detail="Could not verify CSV.")

    end_time = time.time()
    result = {
        "analysis_type":"csv", "model":"VADER", "sentiment":"Summary",
        "score":reviews_processed, "chart_data":counts,
        "execution_time":round(end_time-start_time, 4), "preview_data":preview
    }
    if limit_info: result["limit_info"] = limit_info
    return result

# --- ENDPOINT 2: HUGGING FACE ANALYSIS ---
@app.post("/analyze-huggingface/")
async def analyze_huggingface(text_input: str = Form(None), file_input: UploadFile = File(None)):
    start_time = time.time()
    full_text_for_top_words = ""
    try:
        if not hf_tokenizer or not hf_model: raise RuntimeError("HF models not ready.")
        if not text_input and not file_input: raise HTTPException(status_code=400, detail="No input.")
        preview_data = None; analysis_result = None
        if file_input:
            contents = await file_input.read()
            if not contents: raise HTTPException(status_code=400, detail="File empty.")
            filename = file_input.filename or "file"
            try: full_text_for_top_words = contents.decode('utf-8', errors='ignore')
            except Exception: full_text_for_top_words = contents.decode('latin-1', errors='ignore')
            if filename.endswith('.txt'): analysis_result = analyze_hf_text(full_text_for_top_words, start_time, preview=None)
            elif filename.endswith('.csv'): preview_data = get_csv_preview(contents); analysis_result = analyze_hf_csv(contents, start_time, preview_data) # Limit is inside
            else: raise HTTPException(status_code=400, detail="Use .txt or .csv.")
        elif text_input: full_text_for_top_words = text_input; analysis_result = analyze_hf_text(text_input, start_time, preview=None)
        if analysis_result: analysis_result["top_words"] = get_top_words(full_text_for_top_words)
        else: raise HTTPException(status_code=500, detail="Analysis failed.")
        return analysis_result
    except Exception as e: return await handle_analysis_error(e)

def analyze_hf_text(text: str, start_time: float, preview: list | None):
    result = analyze_huggingface_text(text)
    end_time = time.time()
    return {"analysis_type":"text", "model":"Hugging Face", "sentiment":result["sentiment"], "score":result["score"], "chart_data":result["chart_data"], "execution_time":round(end_time-start_time, 4), "preview_data":preview}

def analyze_hf_csv(contents: bytes, start_time: float, preview: list | None):
    counts = {"Positive": 0, "Negative": 0, "Neutral": 0, "Unknown": 0}
    limit_info = None
    try: decoded_content = contents.decode('utf-8', errors='ignore')
    except Exception: decoded_content = contents.decode('latin-1', errors='ignore')
    reader = csv.DictReader(io.StringIO(decoded_content))
    review_col = None; fieldnames_lower = {f.lower():f for f in reader.fieldnames or []}
    if not fieldnames_lower: raise HTTPException(status_code=400, detail="CSV empty/no header.")
    for name_lower in ["reviewtext", "review", "text"]:
        if name_lower in fieldnames_lower: review_col = fieldnames_lower[name_lower]; break
    if not review_col: raise HTTPException(status_code=400, detail=f"Review column not found. Header: {reader.fieldnames}")
    
    reviews_processed = 0
    # --- *** REDUCED LIMIT FOR HUGGING FACE *** ---
    MAX_ROWS_HF = 20 # Limit processing to the first 20 rows
    limit_reached = False
    
    for i, row in enumerate(reader):
        if i >= MAX_ROWS_HF:
            print(f"INFO: HF CSV stopped after {MAX_ROWS_HF} rows (limit).")
            limit_info = f"Analysis limited to the first {MAX_ROWS_HF} rows for performance."
            limit_reached = True; break
        
        try:
            text = row.get(review_col)
            if text:
                 if not isinstance(text, str): text = str(text)
                 text_cleaned = text.replace('\n', ' ').replace('\r', '').strip()
                 if text_cleaned:
                     sentiment = analyze_huggingface_text(text_cleaned)["sentiment"]
                     counts[sentiment] = counts.get(sentiment, 0) + 1
                     reviews_processed += 1
        except MemoryError: raise HTTPException(status_code=500, detail=f"Memory Error after ~{reviews_processed} rows (limit {MAX_ROWS_HF}).")
        except Exception as e: print(f"Warn: HF CSV row {i+1} error: {type(e).__name__}. Skipping."); continue

    if reviews_processed == 0 and not limit_reached:
         try: reader_check = csv.DictReader(io.StringIO(decoded_content)); _=next(reader_check); _=next(reader_check); raise HTTPException(status_code=400, detail="No valid reviews processed.")
         except StopIteration: raise HTTPException(status_code=400, detail="CSV has no data rows.")
         except Exception: raise HTTPException(status_code=400, detail="Could not verify CSV.")

    end_time = time.time()
    if counts.get("Unknown", 0) == 0: counts.pop("Unknown", None)
    
    result = { "analysis_type": "csv", "model": "Hugging Face", "sentiment": "Summary", "score": reviews_processed, "chart_data": counts, "execution_time": round(end_time - start_time, 4), "preview_data": preview }
    if limit_info: result["limit_info"] = limit_info
    return result


# --- ENDPOINT 3: TOP WORDS ONLY ---
@app.post("/analyze-topwords/")
async def analyze_topwords(text_input: str = Form(None), file_input: UploadFile = File(None)):
    start_time = time.time()
    try:
        if not text_input and not file_input: raise HTTPException(status_code=400, detail="No input provided.")
        text_content = ""
        if file_input:
            contents = await file_input.read()
            if not contents: raise HTTPException(status_code=400, detail="File empty.")
            try: text_content = contents.decode('utf-8', errors='ignore')
            except Exception: text_content = contents.decode('latin-1', errors='ignore')
        elif text_input: text_content = text_input
        if not text_content.strip(): raise HTTPException(status_code=400, detail="Input text empty.")

        top_words_list = get_top_words(text_content, num_words=20)
        end_time = time.time()

        is_error = isinstance(top_words_list, list) and top_words_list and "error" in top_words_list[0].lower()
        if is_error:
             if "missing" in top_words_list[0].lower(): raise LookupError(top_words_list[0])
             else: raise RuntimeError(top_words_list[0])

        return { "analysis_type": "top_words", "model": "NLTK", "top_words": top_words_list, "execution_time": round(end_time - start_time, 4) }
    except Exception as e: return await handle_analysis_error(e)


# --- Homepage Server ---
@app.get("/", response_class=HTMLResponse)
async def serve_homepage():
    try:
        with open("static/index.html") as f: return HTMLResponse(content=f.read(), status_code=200)
    except FileNotFoundError: print("ERROR: static/index.html not found!"); return HTMLResponse(content="<html><body><h1>Conf Error</h1><p>index.html not found.</p></body></html>", status_code=500)
    except Exception as e: print(f"Error serving homepage: {e}"); return HTMLResponse(content="<html><body><h1>Server Error</h1><p>Could not load homepage.</p></body></html>", status_code=500)
