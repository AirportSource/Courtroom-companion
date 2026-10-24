$root = "C:\Users\adria\Documents\GitHub\Courtroom-companion"

Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "cd '$root\backend'; .venv\Scripts\python -m uvicorn app.main:app --reload --port 8000"
)

Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "cd '$root\frontend'; npm run dev"
)

Start-Sleep -Seconds 2
Start-Process "http://localhost:5173"