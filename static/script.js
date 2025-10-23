document.addEventListener("DOMContentLoaded", () => {
    
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
            navItems.forEach(i => i.classList.remove("active"));
            item.classList.add("active");
            const pageId = item.getAttribute("data-page");
            pages.forEach(p => p.style.display = "none");
            document.getElementById(pageId).style.display = "block";
            if (pageId === "page-comparison") {
                renderComparisonPage();
            }
        });
    });

    // --- Setup Analysis Pages ---
    setupAnalysisPage('vader', '/analyze-vader/');
    setupAnalysisPage('hf', '/analyze-huggingface/');

    // --- Main Setup Function ---
    function setupAnalysisPage(modelType, endpointUrl) {
        const textInput = document.getElementById(`${modelType}-text-input`);
        const fileInput = document.getElementById(`${modelType}-file-input`);
        const fileNameSpan = document.getElementById(`${modelType}-file-name`);
        const analyzeButton = document.getElementById(`${modelType}-analyze-button`);
        const placeholder = document.getElementById(`${modelType}-placeholder`);
        const loader = document.getElementById(`${modelType}-loader`);
        const resultsWrapper = document.getElementById(`${modelType}-results-wrapper`);
        const chartCanvas = document.getElementById(`${modelType}-chart`);
        // Get references to individual result cards inside the wrapper
        const statsCard = resultsWrapper.querySelector(".stats-card");
        const previewCard = resultsWrapper.querySelector(".preview-card");
        const chartCard = resultsWrapper.querySelector(".chart-card");

        // File input label handler
        fileInput.addEventListener("change", () => {
            if (fileInput.files.length > 0) {
                fileNameSpan.textContent = fileInput.files[0].name;
                textInput.disabled = true; textInput.value = "";
            } else {
                fileNameSpan.textContent = "Upload a File (.txt or .csv)";
                textInput.disabled = false;
            }
        });

        // Text input handler
        textInput.addEventListener("input", () => {
            if (textInput.value) {
                fileInput.value = null; fileInput.disabled = true;
                fileNameSpan.textContent = "Upload a File (.txt or .csv)";
            } else {
                fileInput.disabled = false;
            }
        });

        // Analyze button handler
        analyzeButton.addEventListener("click", async () => {
            const text = textInput.value;
            const file = fileInput.files[0];

            if (!text.trim() && !file) {
                alert("Please enter text or upload a file.");
                return;
            }

            // --- Prepare UI for loading ---
            placeholder.style.display = "none";
            resultsWrapper.style.display = "none"; // Hide results wrapper initially
            statsCard.innerHTML = ''; // Clear previous results content
            previewCard.innerHTML = '';
            chartCard.querySelector('canvas').style.display = 'none'; // Hide canvas specifically
            loader.style.display = "flex"; // Show loader

            const formData = new FormData();
            if (file) { formData.append("file_input", file); }
            else { formData.append("text_input", text); }
            
            let analysisData = null; // To store result outside try block
            let errorOccurred = false;

            try {
                const response = await fetch(endpointUrl, {
                    method: "POST", body: formData,
                });
                analysisData = await response.json();
                if (!response.ok) {
                    throw new Error(analysisData.detail || `Analysis failed with status ${response.status}`);
                }
                
                // --- Success: Store data ---
                if (modelType === 'vader') { vaderLastResult = analysisData; }
                else { hfLastResult = analysisData; }
                
            } catch (error) {
                errorOccurred = true;
                console.error("Error during analysis:", error);
                 // --- Display Error State ---
                placeholder.style.display = "none";
                resultsWrapper.style.display = "flex"; // Show wrapper
                statsCard.style.display = 'block'; // Show stats card for error message
                previewCard.style.display = 'none'; // Hide others
                chartCard.style.display = 'none';
                statsCard.innerHTML = `<p style="color: red; text-align: center; padding: 20px;"><b><i class="fa-solid fa-triangle-exclamation"></i> Error:</b> ${error.message}</p>`;
            } finally {
                 loader.style.display = "none"; // Always hide loader
                 // --- Render Results (only if no error) ---
                 if (!errorOccurred && analysisData) {
                    renderResults(modelType, analysisData, chartCanvas); // Pass canvas element
                 }
                 resetInputs(textInput, fileInput, fileNameSpan); // Always reset inputs
            }
        });
    }

    // --- Render Results ---
    function renderResults(modelType, data, chartCanvas) { // Receive canvas element
        const resultsWrapper = document.getElementById(`${modelType}-results-wrapper`);
        const statsCard = resultsWrapper.querySelector(".stats-card");
        const previewCard = resultsWrapper.querySelector(".preview-card");
        const chartCard = resultsWrapper.querySelector(".chart-card");

        // --- Make sure wrapper is visible before adding content ---
        resultsWrapper.style.display = "flex";

        // 1. Build and display Stats Card
        const sentimentClass = data.sentiment ? data.sentiment.toLowerCase() : 'neutral'; // Handle potential undefined
        let scoreLabel = modelType === 'vader' ? 'Compound Score' : 'Confidence';
        let scoreValue = (typeof data.score === 'number') ? data.score.toFixed(4) : 'N/A'; // Handle potential undefined

        if (data.analysis_type === 'csv') {
            scoreLabel = "Total Reviews";
            scoreValue = data.score || 0; // Use 0 if score is missing
        }

        statsCard.innerHTML = `
            <h3>Analysis Stats</h3>
            <div class="stats-grid">
                <div class="stat-item">
                    <div class="label">Model</div>
                    <div class="value">${data.model || 'N/A'}</div>
                </div>
                <div class="stat-item">
                    <div class="label">Execution Time</div>
                    <div class="value">${data.execution_time !== undefined ? data.execution_time + ' s' : 'N/A'}</div>
                </div>
                <div class="stat-item">
                    <div class="label">Sentiment</div>
                    <div class="value ${sentimentClass}">${data.sentiment || 'N/A'}</div>
                </div>
                <div class="stat-item">
                    <div class="label">${scoreLabel}</div>
                    <div class="value ${sentimentClass}">${scoreValue}</div>
                </div>
            </div>
        `;
        statsCard.style.display = 'block'; // Ensure it's visible

        // 2. Build and display Preview Card (if data exists)
        if (data.preview_data && data.preview_data.length > 0) {
            previewCard.innerHTML = `
                <h3>Data Preview (First 5 Rows)</h3>
                <div class="preview-table-wrapper">
                    ${buildPreviewTable(data.preview_data)}
                </div>
            `;
            previewCard.style.display = "block";
        } else {
            previewCard.style.display = "none"; // Hide if no preview data
        }
        
        // 3. Build and display Chart (if data exists)
        if (data.chart_data && Object.keys(data.chart_data).length > 0) {
            chartCard.style.display = "block"; // Ensure chart card is visible
            renderChart(modelType, data.analysis_type, data.chart_data, chartCanvas); // Pass canvas element
        } else {
             chartCard.style.display = "none"; // Hide if no chart data
        }
    }


    // --- Render Chart ---
    function renderChart(modelType, analysisType, chartData, canvas) { // Receive canvas element
        let chartInstance = modelType === 'vader' ? vaderChartInstance : hfChartInstance;
        if (chartInstance) { chartInstance.destroy(); } // Destroy previous

        // Ensure canvas is visible before getting context
        canvas.style.display = 'block';
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            console.error("Could not get canvas context");
            return;
        }


        if (analysisType === 'text') {
            const labels = Object.keys(chartData);
            const data = Object.values(chartData);
            let backgroundColors;
             if (modelType === 'vader') {
                 // VADER order might vary slightly, match colors by key
                 backgroundColors = labels.map(label => {
                     if (label.toLowerCase() === 'pos') return 'rgba(40, 167, 69, 0.7)';
                     if (label.toLowerCase() === 'neg') return 'rgba(220, 53, 69, 0.7)';
                     if (label.toLowerCase() === 'neu') return 'rgba(108, 117, 125, 0.7)';
                     if (label.toLowerCase() === 'compound') return 'rgba(0, 123, 255, 0.7)';
                     return 'rgba(150, 150, 150, 0.7)'; // Default
                 });
             } else { // HF
                 // HF model returns Negative, Neutral, Positive typically
                 backgroundColors = labels.map(label => {
                     if (label.toLowerCase() === 'negative') return 'rgba(220, 53, 69, 0.7)';
                     if (label.toLowerCase() === 'neutral') return 'rgba(108, 117, 125, 0.7)';
                     if (label.toLowerCase() === 'positive') return 'rgba(40, 167, 69, 0.7)';
                     return 'rgba(150, 150, 150, 0.7)'; // Default
                 });
             }
            chartInstance = new Chart(ctx, {
                type: 'bar',
                data: { labels: labels, datasets: [{ label: 'Score', data: data, backgroundColor: backgroundColors }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 1.0 } } }
            });

        } else { // CSV - Pie Chart
            const labels = Object.keys(chartData);
            const data = Object.values(chartData);
             const backgroundColors = labels.map(label => {
                 if (label.toLowerCase() === 'positive') return 'rgba(40, 167, 69, 0.7)';
                 if (label.toLowerCase() === 'negative') return 'rgba(220, 53, 69, 0.7)';
                 if (label.toLowerCase() === 'neutral') return 'rgba(108, 117, 125, 0.7)';
                 return 'rgba(150, 150, 150, 0.7)'; // Default
             });
            chartInstance = new Chart(ctx, {
                type: 'pie',
                data: { labels: labels, datasets: [{ data: data, backgroundColor: backgroundColors }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } } }
            });
        }
        
        if (modelType === 'vader') { vaderChartInstance = chartInstance; }
        else { hfChartInstance = chartInstance; }
    }
    
    // --- Render Page 3: Comparison ---
    function renderComparisonPage() {
        const content = document.getElementById("comparison-content");
        if (vaderLastResult && hfLastResult) {
            let vaderScoreLabel = vaderLastResult.analysis_type === 'csv' ? 'Total Reviews' : 'Compound Score';
            let hfScoreLabel = hfLastResult.analysis_type === 'csv' ? 'Total Reviews' : 'Confidence Score';
            
             // Safely access properties with optional chaining or defaults
            const vaderSentiment = vaderLastResult.sentiment || 'N/A';
            const hfSentiment = hfLastResult.sentiment || 'N/A';
            const vaderScore = (typeof vaderLastResult.score === 'number') ? vaderLastResult.score.toFixed(4) : 'N/A';
            const hfScore = (typeof hfLastResult.score === 'number') ? hfLastResult.score.toFixed(4) : 'N/A';
            const vaderTime = vaderLastResult.execution_time !== undefined ? vaderLastResult.execution_time + ' s' : 'N/A';
            const hfTime = hfLastResult.execution_time !== undefined ? hfLastResult.execution_time + ' s' : 'N/A';

            content.innerHTML = `
                <p>Comparing the last analysis run on both models. For a true comparison, please analyze the same input on both pages.</p>
                <table class="comparison-table">
                    <thead><tr><th>Metric</th><th>VADER</th><th>Hugging Face (RoBERTa)</th></tr></thead>
                    <tbody>
                        <tr><td>Analysis Type</td><td>${vaderLastResult.analysis_type || 'N/A'}</td><td>${hfLastResult.analysis_type || 'N/A'}</td></tr>
                        <tr><td>Sentiment</td><td class="${vaderSentiment.toLowerCase()}">${vaderSentiment}</td><td class="${hfSentiment.toLowerCase()}">${hfSentiment}</td></tr>
                        <tr><td>Score</td><td>${vaderScore} <i>(${vaderScoreLabel})</i></td><td>${hfScore} <i>(${hfScoreLabel})</i></td></tr>
                        <tr><td>Execution Time</td><td>${vaderTime}</td><td>${hfTime}</td></tr>
                    </tbody>
                </table>`;
        } else {
             content.innerHTML = `
                <div class="placeholder-page" style="min-height: 200px;">
                    <i class="fa-solid fa-info-circle"></i><h2>No Data to Compare</h2>
                    <p>Please run an analysis on both the <strong>VADER Analysis</strong> and <strong>Hugging Face Analysis</strong> pages. The results will appear here automatically.</p>
                </div>`;
        }
    }

    // --- Helper Functions ---
    function buildPreviewTable(rows) {
        if (!rows || rows.length === 0) return '<p>No preview data available.</p>';
        let html = '<table class="preview-table"><thead><tr>';
        const header = rows[0];
        if (!header) return '<p>Invalid preview data (missing header).</p>';
        header.forEach(h => html += `<th>${h || ''}</th>`);
        html += '</tr></thead><tbody>';
        for (let i = 1; i < rows.length; i++) {
            html += '<tr>';
            const row = rows[i] || [];
            for(let j=0; j<header.length; j++){ html += `<td>${row[j] || ''}</td>`; }
            html += '</tr>';
        }
        html += '</tbody></table>';
        return html;
    }
    
    function resetInputs(text, file, span) {
        text.value = ""; file.value = null;
        span.textContent = "Upload a File (.txt or .csv)";
        text.disabled = false; file.disabled = false;
    }

}); // End DOMContentLoaded