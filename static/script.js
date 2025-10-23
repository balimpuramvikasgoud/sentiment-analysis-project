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
            // Remove active class from all
            navItems.forEach(i => i.classList.remove("active"));
            // Add active class to clicked item
            item.classList.add("active");
            
            const pageId = item.getAttribute("data-page");
            
            // Hide all pages
            pages.forEach(p => p.style.display = "none");
            
            // Show the target page
            document.getElementById(pageId).style.display = "block";
            
            // If it's the comparison page, refresh it
            if (pageId === "page-comparison") {
                renderComparisonPage();
            }
        });
    });

    // --- Page 1: VADER ---
    setupAnalysisPage('vader');
    
    // --- Page 2: HUGGING FACE ---
    setupAnalysisPage('hf');

    // --- Main Setup Function for Analysis Pages ---
    function setupAnalysisPage(modelType) {
        const textInput = document.getElementById(`${modelType}-text-input`);
        const fileInput = document.getElementById(`${modelType}-file-input`);
        const fileNameSpan = document.getElementById(`${modelType}-file-name`);
        const analyzeButton = document.getElementById(`${modelType}-analyze-button`);
        const outputArea = document.getElementById(`${modelType}-output-area`);
        const placeholder = document.getElementById(`${modelType}-placeholder`);
        const loader = document.getElementById(`${modelType}-loader`);
        const resultsWrapper = document.getElementById(`${modelType}-results-wrapper`);
        const chartCanvas = document.getElementById(`${modelType}-chart`);

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

            // Prepare UI for loading
            placeholder.style.display = "none";
            resultsWrapper.style.display = "none";
            loader.style.display = "flex";

            // Prepare FormData
            const formData = new FormData();
            if (file) {
                formData.append("file_input", file);
            } else {
                formData.append("text_input", text);
            }
            
            try {
                const response = await fetch(`/analyze-${modelType}/`, {
                    method: "POST",
                    body: formData,
                });

                const data = await response.json();
                
                if (!response.ok) {
                    throw new Error(data.detail || "Analysis failed");
                }
                
                // --- Success: Store and Render ---
                if (modelType === 'vader') {
                    vaderLastResult = data;
                } else {
                    hfLastResult = data;
                }
                
                renderResults(modelType, data, chartCanvas);
                
            } catch (error) {
                console.error("Error:", error);
                outputArea.innerHTML = `<p style="color: red; text-align: center;"><b>Error:</b> ${error.message}</p>`;
            } finally {
                // Hide loader
                loader.style.display = "none";
                resetInputs(textInput, fileInput, fileNameSpan);
            }
        });
    }

    // --- Render Results ---
    function renderResults(modelType, data, chartCanvas) {
        const resultsWrapper = document.getElementById(`${modelType}-results-wrapper`);
        const statsCard = resultsWrapper.querySelector(".stats-card");
        const previewCard = resultsWrapper.querySelector(".preview-card");
        
        // 1. Build Stats Card
        const sentimentClass = data.sentiment.toLowerCase();
        let scoreLabel = modelType === 'vader' ? 'Compound Score' : 'Confidence';
        let scoreValue = data.score.toFixed(4);
        
        if (data.analysis_type === 'csv') {
            scoreLabel = "Total Reviews";
            scoreValue = data.score; // This is the total count
        }
        
        statsCard.innerHTML = `
            <h3>Analysis Stats</h3>
            <div class="stats-grid">
                <div class="stat-item">
                    <div class="label">Model</div>
                    <div class="value">${data.model}</div>
                </div>
                <div class="stat-item">
                    <div class="label">Execution Time</div>
                    <div class="value">${data.execution_time} s</div>
                </div>
                <div class="stat-item">
                    <div class="label">Sentiment</div>
                    <div class="value ${sentimentClass}">${data.sentiment}</div>
                </div>
                <div class="stat-item">
                    <div class="label">${scoreLabel}</div>
                    <div class="value ${sentimentClass}">${scoreValue}</div>
                </div>
            </div>
        `;
        
        // 2. Build Preview Card
        if (data.preview_data) {
            previewCard.innerHTML = `
                <h3>Data Preview (First 5 Rows)</h3>
                <div class="preview-table-wrapper">
                    ${buildPreviewTable(data.preview_data)}
                </div>
            `;
            previewCard.style.display = "block";
        } else {
            previewCard.style.display = "none";
        }
        
        // 3. Build Chart
        renderChart(modelType, data.analysis_type, data.chart_data, chartCanvas);
        
        // 4. Show results
        resultsWrapper.style.display = "flex";
    }

    // --- Render Chart ---
    function renderChart(modelType, analysisType, chartData, canvas) {
        let chartInstance = modelType === 'vader' ? vaderChartInstance : hfChartInstance;

        // Destroy previous chart if it exists
        if (chartInstance) {
            chartInstance.destroy();
        }

        const ctx = canvas.getContext('2d');
        
        if (analysisType === 'text') {
            // Bar Chart for single text
            const labels = Object.keys(chartData);
            const data = Object.values(chartData);
            chartInstance = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Score',
                        data: data,
                        backgroundColor: [
                            'rgba(40, 167, 69, 0.7)',  // Positive
                            'rgba(220, 53, 69, 0.7)', // Negative
                            'rgba(108, 117, 125, 0.7)', // Neutral
                            'rgba(0, 123, 255, 0.7)'  // Compound/Other
                        ]
                    }]
                },
                options: {
                    responsive: true,
                    plugins: { legend: { display: false } },
                    title: { display: true, text: 'Sentiment Scores' }
                }
            });
        } else {
            // Pie Chart for CSV
            const labels = Object.keys(chartData);
            const data = Object.values(chartData);
            chartInstance = new Chart(ctx, {
                type: 'pie',
                data: {
                    labels: labels,
                    datasets: [{
                        data: data,
                        backgroundColor: [
                            'rgba(40, 167, 69, 0.7)',  // Positive
                            'rgba(220, 53, 69, 0.7)', // Negative
                            'rgba(108, 117, 125, 0.7)'  // Neutral
                        ]
                    }]
                },
                options: {
                    responsive: true,
                    plugins: { legend: { position: 'top' } },
                    title: { display: true, text: 'Review Sentiment Breakdown' }
                }
            });
        }
        
        if (modelType === 'vader') {
            vaderChartInstance = chartInstance;
        } else {
            hfChartInstance = chartInstance;
        }
    }
    
    // --- Render Page 3: Comparison ---
    function renderComparisonPage() {
        const content = document.getElementById("comparison-content");
        
        if (vaderLastResult && hfLastResult) {
            content.innerHTML = `
                <p>Comparing the last analysis run on both models. Ensure you have analyzed the same input on both pages for a direct comparison.</p>
                <table class="comparison-table">
                    <thead>
                        <tr>
                            <th>Metric</th>
                            <th>VADER</th>
                            <th>Hugging Face (RoBERTa)</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>Analysis Type</td>
                            <td>${vaderLastResult.analysis_type}</td>
                            <td>${hfLastResult.analysis_type}</td>
                        </tr>
                        <tr>
                            <td>Sentiment</td>
                            <td class="${vaderLastResult.sentiment.toLowerCase()}">${vaderLastResult.sentiment}</td>
                            <td class="${hfLastResult.sentiment.toLowerCase()}">${hfLastResult.sentiment}</td>
                        </tr>
                        <tr>
                            <td>Score</td>
                            <td>${vaderLastResult.score.toFixed(4)}</td>
                            <td>${hfLastResult.score.toFixed(4)}</td>
                        </tr>
                        <tr>
                            <td>Execution Time</td>
                            <td>${vaderLastResult.execution_time} s</td>
                            <td>${hfLastResult.execution_time} s</td>
                        </tr>
                    </tbody>
                </table>
            `;
        } else {
            content.innerHTML = `
                <div class="placeholder-page" style="min-height: 200px;">
                    <i class="fa-solid fa-info-circle"></i>
                    <h2>No Data to Compare</h2>
                    <p>Please run an analysis on both the <strong>VADER Analysis</strong> and <strong>Hugging Face Analysis</strong> pages. The results will appear here automatically.</p>
                </div>
            `;
        }
    }

    // --- Helper Functions ---
    function buildPreviewTable(rows) {
        let html = '<table class="preview-table"><thead><tr>';
        const header = rows[0];
        header.forEach(h => html += `<th>${h}</th>`);
        html += '</tr></thead><tbody>';
        
        for (let i = 1; i < rows.length; i++) {
            html += '<tr>';
            rows[i].forEach(col => html += `<td>${col}</td>`);
            html += '</tr>';
        }
        
        html += '</tbody></table>';
        return html;
    }
    
    function resetInputs(text, file, span) {
        text.value = "";
        file.value = null;
        span.textContent = "Upload a File (.txt or .csv)";
        text.disabled = false;
        file.disabled = false;
    }

});
