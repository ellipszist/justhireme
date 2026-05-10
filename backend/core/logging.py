import logging
import os
import sys
import json
import time
import functools
from collections.abc import Mapping


class StructuredFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(record.created)),
            "level": record.levelname,
            "module": record.name,
            "msg": record.getMessage(),
        }
        for key in ("domain", "duration_ms", "job_id"):
            if hasattr(record, key):
                entry[key] = getattr(record, key)
        context = context_payload(record)
        if context:
            entry["context"] = dict(context)
        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(entry, ensure_ascii=False)


def get_logger(name: str) -> logging.Logger:
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger

    level_str = os.environ.get("JHM_LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_str, logging.INFO)
    logger.setLevel(level)

    handler = logging.StreamHandler(sys.stderr)
    handler.setLevel(level)

    handler.setFormatter(StructuredFormatter())
    logger.addHandler(handler)
    logger.propagate = False
    return logger


def with_context(logger: logging.Logger, **context) -> logging.LoggerAdapter:
    return logging.LoggerAdapter(logger, {"jhm_context": context})


def context_payload(record: logging.LogRecord) -> Mapping:
    payload = getattr(record, "jhm_context", None)
    return payload if isinstance(payload, Mapping) else {}


def timed(func):
    @functools.wraps(func)
    async def wrapper(*args, **kwargs):
        logger = get_logger(func.__module__)
        start = time.perf_counter()
        try:
            result = await func(*args, **kwargs)
            elapsed = (time.perf_counter() - start) * 1000
            logger.info("%s completed", func.__qualname__, extra={"duration_ms": round(elapsed, 1)})
            return result
        except Exception:
            elapsed = (time.perf_counter() - start) * 1000
            logger.exception("%s failed", func.__qualname__, extra={"duration_ms": round(elapsed, 1)})
            raise

    return wrapper
