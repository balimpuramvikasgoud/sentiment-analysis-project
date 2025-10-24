document.addEventListener("DOMContentLoaded", () => {
    console.log("DOM fully loaded and parsed"); // Log: Script start

    // --- Global State ---
    let vaderLastResult = null;
    let hfLastResult = null;
    let vaderChartInstance = null;
    let hfChartInstance = null;
    
    // --- Page Navigation ---
    const navItems = document.querySelectorAll(".nav-item");
    const pages = document.querySelectorAll(".page-content");

    navItems.forEach(item => {
        item.addEventListener("click", () => {
            console.log("Nav item clicked:", item.getAttribute("data-page")); // Log: Navigation
            navItems.forEach(i => i.classList.remove("active"));
            item.classList.add("active");
            const pageId = item.getAttribute("data-page");
            pages.forEach(p => p.style.display = "none");
            const targetPage = document.getElementById(pageId);
            if (targetPage) {
                targetPage.style.display = "block";
            } else {
                 console.error(`Navigation Error: Page with ID ${pageId} not found.`);
            }
            if (pageId === "page-comparison") {
                renderComparisonPage();
            }
        });
    });

    // --- Setup Analysis Pages ---
    setupAnalysisPage('vader', '/analyze-vader/');
    setupAnalysisPage('hf', '/analyze-huggingface/');
    setupAnalysisPage('topwords', '/analyze-topwords/'); // Setup for Top Words page

    // --- Setup Download Button ---
    setupDownloadButton();


    // --- Main Setup Function ---
    function setupAnalysisPage(pageType, endpointUrl) {
        console.log(`Setting up page: ${pageType}`); // Log: Setup start

        // Get elements specific to this page
        const textInput = document.getElementById(`${pageType}-text-input`);
        const fileInput = document.getElementById(`${pageType}-file-input`);
        const fileNameSpan = document.getElementById(`${pageType}-file-name`);
        const analyzeButton = document.getElementById(`${pageType}-analyze-button`);
        const placeholder = document.getElementById(`${pageType}-placeholder`);
        const loader = document.getElementById(`${pageType}-loader`);
        const resultsWrapper = document.getElementById(`${pageType}-results-wrapper`);
        const chartCanvas = document.getElementById(`${pageType}-chart`);
        
        // Get references to individual result cards IF they exist
        const statsCard = resultsWrapper ? resultsWrapper.querySelector(".stats-card") : null;
        const previewCard = resultsWrapper ? resultsWrapper.querySelector(".preview-card") : null;
        const chartCard = resultsWrapper ? resultsWrapper.querySelector(".chart-card") : null;
        const topWordsCard = resultsWrapper ? resultsWrapper.querySelector(".top-words-card") : null;

        // --- Add listeners only if elements exist ---
        if(fileInput && fileNameSpan && textInput) {
            fileInput.addEventListener("change", () => {
                if (fileInput.files.length > 0) {
                    fileNameSpan.textContent = fileInput.files[0].name;
                    textInput.disabled = true; textInput.value = "";
                } else {
                    fileNameSpan.textContent = "Upload a File (.txt or .csv)";
                    textInput.disabled = false;
                }
            });
        } else if (fileInput) {
             console.warn(`Missing fileNameSpan or textInput for file input on page ${pageType}`);
        }

        if(textInput && fileInput && fileNameSpan) {
            textInput.addEventListener("input", () => {
                if (textInput.value) {
                    fileInput.value = null; fileInput.disabled = true;
                    fileNameSpan.textContent = "Upload a File (.txt or .csv)";
                } else {
                    fileInput.disabled = false;
                }
            });
        } else if (textInput) {
             console.warn(`Missing fileInput or fileNameSpan for text input on page ${pageType}`);
        }

        // --- CRITICAL: Check if Analyze button exists before adding listener ---
        if (analyzeButton) {
            console.log(`Attaching analyze listener to button ID: ${analyzeButton.id}`); // Log: Listener attach
            analyzeButton.addEventListener("click", async () => {
                console.log(`Analyze button clicked for page: ${pageType}`); // Log: Button click

                // Get current values inside the click handler
                let text = textInput ? textInput.value : '';
                let file = fileInput ? fileInput.files[0] : null;

                if (!text.trim() && !file) {
                    alert("Please enter text or upload a file.");
                    return;
                }

                // Prepare UI for loading
                if (placeholder) placeholder.style.display = "none";
                if (resultsWrapper) resultsWrapper.style.display = "none";
                if (loader) loader.style.display = "flex";

                const formData = new FormData();
                if (file) { formData.append("file_input", file); }
                else { formData.append("text_input", text); }
                
                let analysisData = null;
                let errorOccurred = false;
                let errorMessage = "An unknown error occurred.";

                try {
                    console.log(`Fetching from endpoint: ${endpointUrl}`); // Log: Fetch start
                    const response = await fetch(endpointUrl, {
                        method: "POST", body: formData,
                    });
                    console.log(`Fetch response status: ${response.status}`); // Log: Fetch status
                    analysisData = await response.json();
                    if (!response.ok) {
                        errorMessage = analysisData?.detail || `Analysis failed: ${response.statusText || response.status}`;
                        throw new Error(errorMessage);
                    }
                    console.log(`Fetch successful, received data for ${pageType}:`, analysisData); // Log: Fetch success
                    
                    // Store data IF it's VADER or HF
                    if (pageType === 'vader') { vaderLastResult = analysisData; }
                    else if (pageType === 'hf') { hfLastResult = analysisData; }
                    
                } catch (error) {
                    errorOccurred = true;
                    errorMessage = error.message;
                    console.error(`Error during ${pageType} analysis:`, error);
                } finally {
                     if (loader) loader.style.display = "none";

                     if (errorOccurred) {
                         // Display Error State
                         if(resultsWrapper) resultsWrapper.style.display = "flex";
                         let errorCard = statsCard || topWordsCard;
                         if (errorCard) {
                             errorCard.innerHTML = `<p style="color: red; text-align: center; padding: 20px;"><b><i class="fa-solid fa-triangle-exclamation"></i> Error:</b> ${errorMessage}</p>`;
                              errorCard.style.display = 'block';
                         }
                         if (previewCard) previewCard.style.display = 'none';
                         if (chartCard) chartCard.style.display = 'none';
                         if (pageType !== 'topwords' && topWordsCard) topWordsCard.style.display = 'none';

                     } else if (analysisData) {
                         // Render Results
                         console.log(`Rendering results for ${pageType}`); // Log: Render start
                         if (pageType === 'vader' || pageType === 'hf') {
                             renderSentimentResults(pageType, analysisData, chartCanvas, resultsWrapper, statsCard, previewCard, chartCard, topWordsCard);
                         } else if (pageType === 'topwords') {
                             renderTopWordsPageResults(analysisData, resultsWrapper, statsCard, topWordsCard);
                         }
                         console.log(`Rendering complete for ${pageType}`); // Log: Render end
                     } else {
                          // Handle null/undefined data
                         if(resultsWrapper) resultsWrapper.style.display = "flex";
                         let warnCard = statsCard || topWordsCard;
                         if (warnCard) {
                             warnCard.innerHTML = `<p style="color: orange; text-align: center; padding: 20px;"><b><i class="fa-solid fa-question-circle"></i> Warning:</b> Received no result data from server.</p>`;
                             warnCard.style.display = 'block';
                         }
                          if (previewCard) previewCard.style.display = 'none';
                         if (chartCard) chartCard.style.display = 'none';
                         if (pageType !== 'topwords' && topWordsCard) topWordsCard.style.display = 'none';
                     }
                     // Always reset inputs
                     resetInputs(textInput, fileInput, fileNameSpan);
                }
            });
        } else {
             console.error(`Analyze button not found for page type: ${pageType}`); // Log: Button not found
        }
    } // end setupAnalysisPage

    // --- Render VADER/HF Results (includes top words) ---
    function renderSentimentResults(modelType, data, chartCanvas, resultsWrapper, statsCard, previewCard, chartCard, topWordsCard) {
        if (!resultsWrapper || !statsCard || !previewCard || !chartCard || !topWordsCard) {
            console.error(`Render Error: Missing one or more result card elements for ${modelType}`);
            return;
        }
        resultsWrapper.style.display = "flex";

        // 1. Stats Card
        const sentimentClass = data.sentiment ? data.sentiment.toLowerCase() : 'neutral';
        let scoreLabel = modelType === 'vader' ? 'Compound Score' : 'Confidence';
        let scoreValue = (typeof data.score === 'number') ? data.score.toFixed(4) : 'N/A';
        const executionTime = data.execution_time !== undefined ? `${data.execution_time} s` : 'N/A';
        if (data.analysis_type === 'csv') { scoreLabel = "Total Reviews"; scoreValue = data.score ?? 'N/A'; }
        statsCard.innerHTML = `<h3>Analysis Stats</h3><div class="stats-grid"><div class="stat-item"><div class="label">Model</div><div class="value">${data.model || 'N/A'}</div></div><div class="stat-item"><div class="label">Execution Time</div><div class="value">${executionTime}</div></div><div class="stat-item"><div class="label">Sentiment</div><div class="value ${sentimentClass}">${data.sentiment || 'N/A'}</div></div><div class="stat-item"><div class="label">${scoreLabel}</div><div class="value ${sentimentClass}">${scoreValue}</div></div></div>`;
        statsCard.style.display = 'block';

        // 2. Preview Card
        if (data.preview_data && Array.isArray(data.preview_data) && data.preview_data.length > 0) {
            previewCard.innerHTML = `<h3>Data Preview (First 5 Rows)</h3><div class="preview-table-wrapper">${buildPreviewTable(data.preview_data)}</div>`;
            previewCard.style.display = "block";
        } else {
            previewCard.innerHTML = ''; previewCard.style.display = "none";
        }
        
        // 3. Chart Card
        if (data.chart_data && typeof data.chart_data === 'object' && Object.keys(data.chart_data).length > 0) {
            chartCard.style.display = "block";
             requestAnimationFrame(() => { renderChart(modelType, data.analysis_type, data.chart_data, chartCanvas); });
        } else {
             chartCard.style.display = "none";
             let chartInstance = modelType === 'vader' ? vaderChartInstance : hfChartInstance;
             if (chartInstance) { chartInstance.destroy(); }
             if (modelType === 'vader') { vaderChartInstance = null; } else { hfChartInstance = null; }
        }

        // 4. Top Words Card
        if (data.top_words && Array.isArray(data.top_words) && data.top_words.length > 0) {
            if (data.top_words[0].toLowerCase().includes("error") || data.top_words[0].toLowerCase().includes("unavailable")) {
                 topWordsCard.innerHTML = `<h3>Top Keywords Found</h3><p style="color: orange;">${data.top_words[0]}</p>`;
            } else {
                let listItems = data.top_words.map(word => `<li>${word}</li>`).join('');
                topWordsCard.innerHTML = `<h3>Top Keywords Found</h3><ul class="top-words-list">${listItems}</ul>`;
            }
            topWordsCard.style.display = 'block';
        } else {
             topWordsCard.innerHTML = ''; topWordsCard.style.display = 'none';
        }
    }

    // --- Render Dedicated Top Words Page Results ---
    function renderTopWordsPageResults(data, resultsWrapper, statsCard, topWordsCard) {
         if (!resultsWrapper || !statsCard || !topWordsCard) {
             console.error("Render Error: Missing elements for Top Words page results.");
             return;
         }
         resultsWrapper.style.display = "flex";

         // 1. Display Execution Time in Stats Card
         const executionTime = data.execution_time !== undefined ? `${data.execution_time} s` : 'N/A';
         statsCard.innerHTML = `<h3>Extraction Stats</h3><div class="stats-grid"><div class="stat-item"><div class="label">Model</div><div class="value">${data.model || 'NLTK'}</div></div><div class="stat-item"><div class="label">Execution Time</div><div class="value">${executionTime}</div></div></div>`;
         statsCard.style.display = 'block';

         // 2. Display Top Words List in Top Words Card
         if (data.top_words && Array.isArray(data.top_words) && data.top_words.length > 0) {
            if (data.top_words[0].toLowerCase().includes("error") || data.top_words[0].toLowerCase().includes("unavailable")) {
                 topWordsCard.innerHTML = `<h3>Top Keywords Found</h3><p style="color: orange;">${data.top_words[0]}</p>`;
            } else {
                let listItems = data.top_words.map(word => `<li>${word}</li>`).join('');
                topWordsCard.innerHTML = `<h3>Top Keywords Found (Max 20)</h3><ul class="top-words-list">${listItems}</ul>`;
            }
            topWordsCard.style.display = 'block';
        } else {
             topWordsCard.innerHTML = '<h3>Top Keywords Found</h3><p>No significant keywords found after filtering.</p>';
             topWordsCard.style.display = 'block';
        }
    }


    // --- Render Chart ---
    function renderChart(modelType, analysisType, chartData, canvas) {
        let chartInstance = modelType === 'vader' ? vaderChartInstance : hfChartInstance;
        if (chartInstance) { chartInstance.destroy(); }
        if (!canvas) { console.error(`Canvas element not found for ${modelType} chart.`); return; }
        canvas.style.display = 'block'; const ctx = canvas.getContext('2d');
        if (!ctx) { console.error(`Could not get canvas context for ${modelType}`); return; }

        let chartConfig={type:'bar',options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true}}},data:{labels:[],datasets:[]}};
        const labels=Object.keys(chartData); const dataValues=Object.values(chartData);

        if(analysisType==='text'){chartConfig.type='bar';chartConfig.options.scales.y.max=1.0;let bgColors;if(modelType==='vader'){bgColors=labels.map(l=>{if(l.toLowerCase()==='positive')return'rgba(40,167,69,0.7)';if(l.toLowerCase()==='negative')return'rgba(220,53,69,0.7)';if(l.toLowerCase()==='neutral')return'rgba(108,117,125,0.7)';if(l.toLowerCase()==='compound')return'rgba(0,123,255,0.7)';return'rgba(150,150,150,0.7)'})}else{bgColors=labels.map(l=>{if(l.toLowerCase()==='negative')return'rgba(220,53,69,0.7)';if(l.toLowerCase()==='neutral')return'rgba(108,117,125,0.7)';if(l.toLowerCase()==='positive')return'rgba(40,167,69,0.7)';return'rgba(150,150,150,0.7)'})}chartConfig.data={labels:labels,datasets:[{label:'Score',data:dataValues,backgroundColor:bgColors}]}}else{chartConfig.type='pie';chartConfig.options.plugins.legend.display=true;chartConfig.options.plugins.legend.position='top';delete chartConfig.options.scales;const bgColors=labels.map(l=>{if(l.toLowerCase()==='positive')return'rgba(40,167,69,0.7)';if(l.toLowerCase()==='negative')return'rgba(220,53,69,0.7)';if(l.toLowerCase()==='neutral')return'rgba(108,117,125,0.7)';return'rgba(150,150,150,0.7)'});chartConfig.data={labels:labels,datasets:[{data:dataValues,backgroundColor:bgColors}]}}
        try { chartInstance = new Chart(ctx, chartConfig); }
        catch (e) { console.error(`Chart.js error for ${modelType}:`, e); const card = canvas.closest('.chart-card'); if(card) card.innerHTML = `<p style="color:red;text-align:center;">Chart Error.</p>`; }
        if (modelType === 'vader') { vaderChartInstance = chartInstance; } else { hfChartInstance = chartInstance; }
    }
    
    // --- Render Page 3: Comparison ---
    function renderComparisonPage() {
        const content = document.getElementById("comparison-content");
        if (vaderLastResult && hfLastResult) {
            let vSL=vaderLastResult.analysis_type==='csv'?'Total':'Compound';let hSL=hfLastResult.analysis_type==='csv'?'Total':'Confidence';
            const vS=vaderLastResult.sentiment||'N/A';const hS=hfLastResult.sentiment||'N/A';
            const vSc=(typeof vaderLastResult.score==='number')?vaderLastResult.score.toFixed(4):'N/A';const hSc=(typeof hfLastResult.score==='number')?hfLastResult.score.toFixed(4):'N/A';
            const vT=vaderLastResult.execution_time!==undefined?vaderLastResult.execution_time+' s':'N/A';const hT=hfLastResult.execution_time!==undefined?hfLastResult.execution_time+' s':'N/A';
            content.innerHTML = `<p>Comparing last analysis. Analyze same input on both pages for direct comparison.</p><table class="comparison-table"><thead><tr><th>Metric</th><th>VADER</th><th>Hugging Face (RoBERTa)</th></tr></thead><tbody><tr><td>Type</td><td>${vaderLastResult.analysis_type||'N/A'}</td><td>${hfLastResult.analysis_type||'N/A'}</td></tr><tr><td>Sentiment</td><td class="${vS.toLowerCase()}">${vS}</td><td class="${hS.toLowerCase()}">${hS}</td></tr><tr><td>Score</td><td>${vSc}<i>(${vSL})</i></td><td>${hSc}<i>(${hSL})</i></td></tr><tr><td>Time</td><td>${vT}</td><td>${hT}</td></tr></tbody></table>`;
        } else { content.innerHTML = `<div class="placeholder-page" style="min-height:200px;"><i class="fa-solid fa-info-circle"></i><h2>No Data to Compare</h2><p>Run analysis on both VADER and Hugging Face pages.</p></div>`; }
    }

    // --- Setup Download Button ---
    function setupDownloadButton() {
        const downloadButton = document.getElementById('download-button');
        const downloadMessage = document.getElementById('download-message');

        if (downloadButton) {
            console.log("Attaching download listener to button ID: download-button"); // Log: Listener attach
            downloadButton.addEventListener('click', () => {
                console.log("Download button clicked"); // Log: Button click
                if (downloadMessage) downloadMessage.textContent = ''; // Clear previous message

                if (vaderLastResult && hfLastResult) {
                    try {
                        console.log("Preparing CSV content for download..."); // Log: Download start
                        let csvContent = "data:text/csv;charset=utf-8,";
                        csvContent += "Model,Analysis Type,Sentiment,Score Label,Score,Execution Time\n"; // Header row

                        const vScoreLabel = vaderLastResult.analysis_type === 'csv' ? 'Total Reviews' : 'Compound Score';
                        const vRow = ["VADER",vaderLastResult.analysis_type||'N/A',vaderLastResult.sentiment||'N/A',vScoreLabel,(typeof vaderLastResult.score==='number')?vaderLastResult.score.toFixed(4):'N/A',vaderLastResult.execution_time!==undefined?vaderLastResult.execution_time:'N/A'].map(String).join(','); // Ensure all are strings
                        csvContent += vRow + "\n";

                        const hfScoreLabel = hfLastResult.analysis_type === 'csv' ? 'Total Reviews' : 'Confidence Score';
                        const hfRow = ["Hugging Face",hfLastResult.analysis_type||'N/A',hfLastResult.sentiment||'N/A',hfScoreLabel,(typeof hfLastResult.score==='number')?hfLastResult.score.toFixed(4):'N/A',hfLastResult.execution_time!==undefined?hfLastResult.execution_time:'N/A'].map(String).join(','); // Ensure all are strings
                        csvContent += hfRow + "\n";

                        const encodedUri = encodeURI(csvContent);
                        const link = document.createElement("a");
                        link.setAttribute("href", encodedUri);
                        link.setAttribute("download", "sentiment_analysis_results.csv");
                        document.body.appendChild(link); link.click(); document.body.removeChild(link);
                        console.log("Download triggered."); // Log: Download trigger
                        if (downloadMessage) downloadMessage.textContent = 'Results downloaded!';

                    } catch(e) { console.error("Error creating download link/file:", e); if (downloadMessage) downloadMessage.textContent = 'Error creating download file.'; }
                } else {
                    console.log("Download button clicked, but missing data."); // Log: Missing data
                    if (downloadMessage) downloadMessage.textContent = 'Please run analysis on both VADER and Hugging Face pages first.';
                    alert('Please run analysis on both VADER and Hugging Face pages first.');
                }
            });
        } else {
             console.error("CRITICAL: Download button (ID: download-button) not found in HTML!"); // Log: Button missing
        }
    } // end setupDownloadButton


    // --- Helper: Build Preview Table ---
    function buildPreviewTable(rows) {
        if (!rows || !Array.isArray(rows) || rows.length === 0) return '<p>No preview data.</p>';
        let html = '<table class="preview-table"><thead><tr>';
        const header = rows[0]; if (!header || !Array.isArray(header)) return '<p>Invalid preview header.</p>';
        header.forEach(h => html += `<th title="${h ?? ''}">${(h ?? '').substring(0,20)}${(h??'').length>20?'...':''}</th>`);
        html += '</tr></thead><tbody>';
        for (let i = 1; i < rows.length; i++) { html += '<tr>'; const row = rows[i] || [];
            for(let j=0; j<header.length; j++){ const cell = row[j] ?? ''; const display = String(cell).length>30?String(cell).substring(0,30)+'...':String(cell); html += `<td title="${cell}">${display}</td>`; } // Ensure cell is string
            html += '</tr>'; }
        html += '</tbody></table>'; return html;
    }
    
    // --- Helper: Reset Inputs ---
    function resetInputs(textInput, fileInput, fileNameSpan) {
        // Added checks to prevent errors if elements don't exist
        if (textInput) {
            textInput.value = "";
            textInput.disabled = false;
        }
        if (fileInput) {
            fileInput.value = null; // Clears the selected file
             fileInput.disabled = false;
        }
       if (fileNameSpan) {
            fileNameSpan.textContent = "Upload a File (.txt or .csv)";
       }
    }

}); // End DOMContentLoaded
