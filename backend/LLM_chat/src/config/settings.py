import os, sys
import yaml
from pydantic import BaseModel
from dotenv import load_dotenv

from typing import Dict

load_dotenv()

class LogSettings(BaseModel):
    LOG_LEVEL: str = "INFO"

class PathsSettings(BaseModel):
    data_dir: Dict[str, str]
    persist_dir: str
    pdf_dir: Dict[str, str]
    output_dir: str

class ProcessingSettings(BaseModel):
    chunk_size: int
    overlap: int

class RuntimeSettings(BaseModel):
    device: str

class EmbeddingsSettings(BaseModel):
    model: str
    base_url: str

class LLMModelsSettings(BaseModel):
    chat: str

class LLMParamsSettings(BaseModel):
    temperature: float
    max_new_tokens: int
    num_ctx: int
    top_k: int
    top_p: float
    seed: int = 42

class LLMSettings(BaseModel):
    provider: str = "groq"
    base_url: str | None = None
    api_key: str | None = None
    models: LLMModelsSettings
    params: LLMParamsSettings
    provider_params: Dict[str, Dict] = {}

class RerankerSettings(BaseModel):
    hf_model_path: str
    device: str
    batch_size: int
    normalize: bool

class RetrievalSettings(BaseModel):
    top_k: int
    fetch_k: int
    enable_reranker: bool

class VectorStoreSettings(BaseModel):
    chroma_path: str = "chroma_db"
    
class AppSettings(BaseModel):
    logging: LogSettings
    paths: PathsSettings
    processing: ProcessingSettings
    runtime: RuntimeSettings
    embedding: EmbeddingsSettings
    vectorstore: VectorStoreSettings
    llm: LLMSettings
    reranker: RerankerSettings
    retrieval: RetrievalSettings

def load_settings() -> AppSettings:
    pasta_do_arquivo = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.normpath(os.path.join(pasta_do_arquivo, "..", "..", "config", "config.yaml")),
        os.path.normpath(os.path.join(os.getcwd(), "LLM_chat", "config", "config.yaml")),
        os.path.normpath(os.path.join(os.getcwd(), "config", "config.yaml")),
    ]
    cfg_file = next((p for p in candidates if os.path.exists(p)), None)
    if not cfg_file:
        raise FileNotFoundError(f"Config file not found. Tried: {candidates}")
    with open(cfg_file, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    settings = AppSettings(**data)

    ollama_env = os.getenv("OLLAMA_HOST")
    if ollama_env:
        settings.embedding.base_url = ollama_env

    if settings.llm.provider == "groq":
        groq_key = (os.getenv("GROQ_API_KEY") or "").strip()
        if groq_key:
            settings.llm.api_key = groq_key
        if not (settings.llm.base_url or "").strip():
            settings.llm.base_url = "https://api.groq.com/openai/v1"

    if settings.llm.provider == "openrouter":
        or_key = (os.getenv("OPENROUTER_API_KEY") or "").strip()
        or_base = (os.getenv("OPENROUTER_BASE_URL") or "").strip() or "https://openrouter.ai/api/v1"
        if or_key:
            settings.llm.api_key = or_key
        settings.llm.base_url = or_base

    if settings.llm.provider == "deepinfra":
        di_key = (
            (os.getenv("DEEPINFRA_API_KEY") or "").strip()
            or (os.getenv("DEEPINFRA_TOKEN") or "").strip()
        )
        di_base = (
            (os.getenv("DEEPINFRA_BASE_URL") or "").strip()
            or "https://api.deepinfra.com/v1/openai"
        )
        if di_key:
            settings.llm.api_key = di_key
        settings.llm.base_url = di_base

    return settings
