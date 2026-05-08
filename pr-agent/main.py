from fastapi import FastAPI

app = FastAPI(title="shiwake-ai PR Agent")


@app.get("/")
async def health():
    return {"status": "ok"}
