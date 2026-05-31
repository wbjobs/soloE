@echo off
echo Starting Streamlit Frontend...
echo Frontend will be available at http://localhost:8501
echo.
streamlit run frontend.py --server.headless true
pause
