"""Portable paths and database configuration for vision-attend."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def project_path(relative):
    return str(ROOT / relative)


def database_options(auth=False):
    return {
        "host": os.getenv("VISION_ATTEND_DB_HOST", "localhost"),
        "port": int(os.getenv("VISION_ATTEND_DB_PORT", "3306")),
        "user": os.getenv("VISION_ATTEND_DB_USER", "vision_attend"),
        "password": os.getenv("VISION_ATTEND_DB_PASSWORD", ""),
        "database": os.getenv(
            "VISION_ATTEND_AUTH_DB" if auth else "VISION_ATTEND_DB",
            "vision_attend_auth" if auth else "vision_attend",
        ),
    }
