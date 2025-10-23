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

# --- Hugging Face Imports ---
import torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification

# --- Model Name ---
MODEL_NAME = "cardiffnlp/twitter-roberta-base-sentiment-latest"

# --- LIFESPAN EVENT: Runs on server startup to load models ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    # This code runs ONCE when the server starts
    print("Server starting up...")
    
    # Load VADER
    print("Warming up VADER model...")
    global vader_analyzer
    vader_analyzer = SentimentIntensityAnalyzer()
    
    # Load Hugging Face Model
    # This is the SLOW part. It will download ~1.4GB if not cached.
    print(f"Warming up Hugging Face model: {MODEL_NAME}...")
    print("This may take 2-5 minutes if downloading for the first time...")
    global hf_tokenizer, hf_model
    hf_tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    hf_model = AutoModelForSequenceClassification.from_pretrained(MODEL_NAME)
    
    print("All models are ready. Server startup complete.")
    
    yield
    
    # This code runs when the server shuts down
    print("Server shutting down...")

# --- Create FastAPI App ---
app = FastAPI(lifespan=lifespan) 

# Mount static folder
app.mount("/static", StaticFiles(directory="static"), name="static")

# --- Pydantic Model for Text ---
class TextInput(BaseModel):
    text: str

# --- Helper: Get CSV Preview ---
def get_csv_preview(content: bytes):
    """Gets the header and first 5 rows of a CSV."""
    preview_data = []
    try:
        decoded_content = content.decode('utf-8')
    except UnicodeDecodeError:
        decoded_content = content.decode('latin-1')
        
    reader = csv.reader(io.StringIO(decoded_content))
    
    try:
        header = next(reader)
        preview_data.append(header)
        for i, row in enumerate(reader):
            if i >= 5:
                break
            preview_data.append(row)
        return preview_data
    except Exception:
        return None # Failed to read CSV

# --- Helper: Analyze text with Hugging Face ---
def analyze_huggingface_text(text: str):
    inputs = hf_tokenizer(text, return_tensors='pt', truncation=True, max_length=512)
    with torch.no_grad():
        outputs = hf_model(**inputs)
    
    logits = outputs.logits
    scores = torch.softmax(logits, dim=1).tolist()[0]
    
    label_id = torch.argmax(logits, dim=1).item()
    sentiment = hf_model.config.id2label[label_id]
    score = scores[label_id] # Confidence score
    
    # For bar chart: { 'Negative': 0.1, 'Neutral': 0.2, 'Positive': 0.7 }
    chart_data = {hf_model.config.id2label[i]: s for i, s in enumerate(scores)}

    return {"sentiment": sentiment, "score": score, "chart_data": chart_data}

# --- ENDPOINT 1: VADER ANALYSIS ---
@app.post("/analyze-vader/")
async def analyze_vader(
    text_input: str = Form(None), 
    file_input: UploadFile = File(None)
):
    start_time = time.time()
    
    if not text_input and not file_input:
        raise HTTPException(status_code=400, detail="No text or file provided.")
    
    preview_data = None
    
    if file_input:
        contents = await file_input.read()
        if not contents:
            raise HTTPException(status_code=400, detail="The uploaded file is empty.")
        
        preview_data = get_csv_preview(contents) # Get preview first
        
        if file_input.filename.endswith('.txt'):
            text = contents.decode('utf-8')
            return analyze_vader_text(text, start_time, preview=None)
        elif file_input.filename.endswith('.csv'):
            return analyze_vader_csv(contents, start_time, preview_data)
        else:
            raise HTTPException(status_code=400, detail="Unsupported file type.")
    
    elif text_input:
        return analyze_vader_text(text_input, start_time, preview=None)

def analyze_vader_text(text: str, start_time: float, preview: dict):
    scores = vader_analyzer.polarity_scores(text)
    compound = scores['compound']
    
    if compound > 0.05: sentiment = "Positive"
    elif compound < -0.05: sentiment = "Negative"
    else: sentiment = "Neutral"
    
    # Bar chart data
    chart_data = {
        'Positive': scores['pos'],
        'Negative': scores['neg'],
        'Neutral': scores['neu'],
        'Compound': scores['compound']
    }
    
    end_time = time.time()
    return {
        "analysis_type": "text",
        "model": "VADER",
        "sentiment": sentiment,
        "score": compound,
        "chart_data": chart_data,
        "execution_time": round(end_time - start_time, 4),
        "preview_data": preview
    }

def analyze_vader_csv(contents: bytes, start_time: float, preview: dict):
    # CSV Pie Chart data
    counts = {"Positive": 0, "Negative": 0, "Neutral": 0}
    
    try:
        decoded_content = contents.decode('utf-8')
    except UnicodeDecodeError:
        decoded_content = contents.decode('latin-1')
        
    reader = csv.DictReader(io.StringIO(decoded_content))
    
    review_col = None
    if not reader.fieldnames:
         raise HTTPException(status_code=400, detail="CSV is empty.")
    for name in ["reviewText", "review", "text", "Review", "Text"]:
        if name in reader.fieldnames:
            review_col = name
            break
    if not review_col:
        raise HTTPException(status_code=400, detail=f"Could not find a review column (e.g., 'reviewText'). Found: {reader.fieldnames}")

    for row in reader:
        text = row.get(review_col)
        if text:
            compound = vader_analyzer.polarity_scores(text)['compound']
            if compound > 0.05: counts["Positive"] += 1
            elif compound < -0.05: counts["Negative"] += 1
            else: counts["Neutral"] += 1
            
    end_time = time.time()
    total = sum(counts.values())
    
    return {
        "analysis_type": "csv",
        "model": "VADER",
        "sentiment": "Summary",
        "score": total, # Total reviews processed
        "chart_data": counts,
        "execution_time": round(end_time - start_time, 4),
        "preview_data": preview
    }

# --- ENDPOINT 2: HUGGING FACE ANALYSIS ---
@app.post("/analyze-huggingface/")
async def analyze_huggingface(
    text_input: str = Form(None), 
    file_input: UploadFile = File(None)
):
    start_time = time.time()
    
    if not text_input and not file_input:
        raise HTTPException(status_code=400, detail="No text or file provided.")
    
    preview_data = None
    
    if file_input:
        contents = await file_input.read()
        if not contents:
            raise HTTPException(status_code=400, detail="File is empty.")
        
        preview_data = get_csv_preview(contents)
        
        if file_input.filename.endswith('.txt'):
            text = contents.decode('utf-8')
            return analyze_hf_text(text, start_time, preview=None)
        elif file_input.filename.endswith('.csv'):
            return analyze_hf_csv(contents, start_time, preview_data)
        else:
            raise HTTPException(status_code=400, detail="Unsupported file type.")
            
    elif text_input:
        return analyze_hf_text(text_input, start_time, preview=None)

def analyze_hf_text(text: str, start_time: float, preview: dict):
    result = analyze_huggingface_text(text)
    end_time = time.time()
    return {
        "analysis_type": "text",
        "model": "Hugging Face",
        "sentiment": result["sentiment"],
        "score": result["score"],
        "chart_data": result["chart_data"],
        "execution_time": round(end_time - start_time, 4),
        "preview_data": preview
    }

def analyze_hf_csv(contents: bytes, start_time: float, preview: dict):
    counts = {"Positive": 0, "Negative": 0, "Neutral": 0}
    
    try:
        decoded_content = contents.decode('utf-8')
    except UnicodeDecodeError:
        decoded_content = contents.decode('latin-1')
        
    reader = csv.DictReader(io.StringIO(decoded_content))
    
    review_col = None
    if not reader.fieldnames:
         raise HTTPException(status_code=400, detail="CSV is empty.")
    for name in ["reviewText", "review", "text", "Review", "Text"]:
        if name in reader.fieldnames:
            review_col = name
            break
    if not review_col:
        raise HTTPException(status_code=400, detail=f"Could not find a review column (e.g., 'reviewText'). Found: {reader.fieldnames}")

    for row in reader:
        text = row.get(review_col)
        if text:
            # We only care about the final sentiment label for the pie chart
            sentiment = analyze_huggingface_text(text)["sentiment"]
            counts[sentiment] += 1
            
    end_time = time.time()
    total = sum(counts.values())
    
    return {
        "analysis_type": "csv",
        "model": "Hugging Face",
        "sentiment": "Summary",
        "score": total, # Total reviews processed
        "chart_data": counts,
        "execution_time": round(end_time - start_time, 4),
        "preview_data": preview
    }

# --- Homepage Server ---
@app.get("/", response_class=HTMLResponse)
async def serve_homepage():
    with open("static/index.html") as f:
        return HTMLResponse(content=f.read(), status_code=200)
