#!/usr/bin/env python3
"""
autoMeetic Week 0 — TRUE GPT Realtime latency measurement
Measures OpenAI Realtime STT latency over WebSocket + Anthropic translation latency.
"""

import asyncio
import base64
import json
import math
import os
import struct
import sys
import time
from pathlib import Path
from typing import Any


def _load_dotenv(dotenv_path: Path) -> None:
    if not dotenv_path.exists():
        return

    for raw_line in dotenv_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def _make_pcm16_tone(sample_rate: int = 24000, seconds: float = 2.0, hz: float = 440.0) -> bytes:
    samples = int(sample_rate * seconds)
    out = bytearray()
    for i in range(samples):
        value = int(0.20 * 32767 * math.sin(2.0 * math.pi * hz * (i / sample_rate)))
        out.extend(struct.pack("<h", value))
    return bytes(out)


async def _measure_realtime_stt_latency(api_key: str) -> dict[str, Any]:
    try:
        import openai
    except ImportError:
        return {
            "status": "FAILED",
            "reason": "Missing openai package (pip install openai)",
            "stt_latency_ms": None,
            "realtime_model_used": None,
            "transcript_preview": None,
        }

    def _ev_type(ev: Any) -> str | None:
        if isinstance(ev, dict):
            return ev.get("type")
        return getattr(ev, "type", None)

    def _ev_get(ev: Any, key: str, default: Any = None) -> Any:
        if isinstance(ev, dict):
            return ev.get(key, default)
        return getattr(ev, key, default)

    def _err_code(err: Any) -> str | None:
        if isinstance(err, dict):
            return err.get("code")
        return getattr(err, "code", None)

    candidate_models = [
        "gpt-4o-realtime-preview",
        "gpt-realtime",
    ]

    pcm = _make_pcm16_tone()
    chunk_size = 3200
    client = openai.AsyncOpenAI(api_key=api_key)
    last_error = "Unknown realtime error"
    full_b64_audio = base64.b64encode(pcm).decode("ascii")

    for model in candidate_models:
        try:
            async with client.beta.realtime.connect(model=model) as conn:
                await conn.session.update(
                    session={
                        "input_audio_format": "pcm16",
                        "input_audio_transcription": {"model": "gpt-4o-mini-transcribe"},
                    }
                )

                for i in range(0, len(pcm), chunk_size):
                    b64_chunk = base64.b64encode(pcm[i : i + chunk_size]).decode("ascii")
                    await conn.input_audio_buffer.append(audio=b64_chunk)

                t0 = time.perf_counter()
                fallback_sent = False
                await asyncio.sleep(0.1)
                try:
                    await conn.input_audio_buffer.commit()
                    await conn.response.create()
                except Exception as e:
                    # Fallback: some environments reject input_audio_buffer.commit as empty.
                    # In that case, send audio as conversation item content and request response.
                    if "input_audio_buffer_commit_empty" in str(e):
                        await conn.conversation.item.create(
                            item={
                                "type": "message",
                                "role": "user",
                                "content": [
                                    {
                                        "type": "input_audio",
                                        "audio": full_b64_audio,
                                    }
                                ],
                            }
                        )
                        await conn.response.create()
                        fallback_sent = True
                    else:
                        raise

                transcript = None
                deadline = time.perf_counter() + 20.0

                while time.perf_counter() < deadline:
                    event = await asyncio.wait_for(conn.recv(), timeout=20)
                    event_type = _ev_type(event)

                    if event_type in {
                        "conversation.item.input_audio_transcription.completed",
                        "response.audio_transcript.done",
                        "response.output_text.done",
                    }:
                        latency_ms = (time.perf_counter() - t0) * 1000.0
                        transcript = (
                            _ev_get(event, "transcript")
                            or _ev_get(event, "text")
                            or str(_ev_get(event, "delta", ""))
                        )
                        return {
                            "status": "SUCCESS",
                            "reason": None,
                            "stt_latency_ms": latency_ms,
                            "realtime_model_used": model,
                            "transcript_preview": (transcript or "")[:120],
                        }

                    if event_type == "error":
                        err = _ev_get(event, "error", {})
                        code = _err_code(err)
                        if code == "input_audio_buffer_commit_empty" and not fallback_sent:
                            try:
                                await conn.response.cancel()
                            except Exception:
                                pass

                            await conn.conversation.item.create(
                                item={
                                    "type": "message",
                                    "role": "user",
                                    "content": [
                                        {
                                            "type": "input_audio",
                                            "audio": full_b64_audio,
                                        }
                                    ],
                                }
                            )
                            await conn.response.create()
                            fallback_sent = True
                            continue

                        last_error = str(err)
                        return {
                            "status": "FAILED",
                            "reason": f"Realtime error: {err}",
                            "stt_latency_ms": None,
                            "realtime_model_used": model,
                            "transcript_preview": None,
                        }

                return {
                    "status": "FAILED",
                    "reason": "Realtime timeout waiting for transcription event",
                    "stt_latency_ms": None,
                    "realtime_model_used": model,
                    "transcript_preview": None,
                }

        except Exception as e:
            last_error = str(e)
            continue

    return {
        "status": "FAILED",
        "reason": f"Could not connect/measure with realtime models: {last_error}",
        "stt_latency_ms": None,
        "realtime_model_used": None,
        "transcript_preview": None,
    }


def _measure_translation_latency(anthropic_key: str, source_text: str) -> dict[str, Any]:
    try:
        from anthropic import Anthropic
    except ImportError:
        return {
            "status": "PARTIAL",
            "reason": "Missing anthropic package",
            "translation_latency_ms": None,
            "translation_model_used": None,
            "translation_preview": None,
        }

    client = Anthropic(api_key=anthropic_key)
    candidates = [
        "claude-sonnet-4-6",
        "claude-sonnet-4-5-20250929",
        "claude-sonnet-4-20250514",
        "claude-haiku-4-5-20251001",
    ]

    prompt = f"Translate to Korean: {source_text or 'Hello, nice to meet you.'}"

    for model in candidates:
        try:
            t0 = time.perf_counter()
            resp = client.messages.create(
                model=model,
                max_tokens=120,
                messages=[{"role": "user", "content": prompt}],
            )
            latency_ms = (time.perf_counter() - t0) * 1000.0
            text = resp.content[0].text if resp.content else ""
            return {
                "status": "SUCCESS",
                "reason": None,
                "translation_latency_ms": latency_ms,
                "translation_model_used": model,
                "translation_preview": text[:120],
            }
        except Exception:
            continue

    return {
        "status": "FAILED",
        "reason": "No available Anthropic translation model",
        "translation_latency_ms": None,
        "translation_model_used": None,
        "translation_preview": None,
    }


async def _run() -> dict[str, Any]:
    _load_dotenv(Path(".env"))

    openai_key = os.environ.get("OPENAI_API_KEY")
    if not openai_key:
        return {
            "status": "FAILED",
            "reason": "Missing OPENAI_API_KEY",
            "realtime_model_used": None,
            "translation_model_used": None,
            "stt_latency_ms": None,
            "translation_latency_ms": None,
            "total_latency_ms": None,
            "result": None,
        }

    anth_key = os.environ.get("ANTHROPIC_API_KEY")
    if not anth_key:
        return {
            "status": "FAILED",
            "reason": "Missing ANTHROPIC_API_KEY",
            "realtime_model_used": None,
            "translation_model_used": None,
            "stt_latency_ms": None,
            "translation_latency_ms": None,
            "total_latency_ms": None,
            "result": None,
        }

    stt = await _measure_realtime_stt_latency(openai_key)
    if stt["status"] != "SUCCESS":
        return {
            "status": "FAILED",
            "reason": stt["reason"],
            "realtime_model_used": stt.get("realtime_model_used"),
            "translation_model_used": None,
            "stt_latency_ms": stt.get("stt_latency_ms"),
            "translation_latency_ms": None,
            "total_latency_ms": None,
            "result": None,
            "stt_preview": stt.get("transcript_preview"),
        }

    trans = _measure_translation_latency(anth_key, stt.get("transcript_preview") or "Hello, nice to meet you.")
    if trans["status"] != "SUCCESS":
        return {
            "status": "FAILED",
            "reason": trans["reason"],
            "realtime_model_used": stt.get("realtime_model_used"),
            "translation_model_used": trans.get("translation_model_used"),
            "stt_latency_ms": stt.get("stt_latency_ms"),
            "translation_latency_ms": None,
            "total_latency_ms": None,
            "result": None,
            "stt_preview": stt.get("transcript_preview"),
            "translation_preview": trans.get("translation_preview"),
        }

    total = float(stt["stt_latency_ms"]) + float(trans["translation_latency_ms"])
    if total < 800:
        verdict = "PASS"
    elif total < 1000:
        verdict = "BORDERLINE"
    else:
        verdict = "FAIL"

    return {
        "status": "SUCCESS",
        "reason": None,
        "realtime_model_used": stt.get("realtime_model_used"),
        "translation_model_used": trans.get("translation_model_used"),
        "stt_latency_ms": stt.get("stt_latency_ms"),
        "translation_latency_ms": trans.get("translation_latency_ms"),
        "total_latency_ms": total,
        "goal_ms": 800,
        "result": verdict,
        "stt_preview": stt.get("transcript_preview"),
        "translation_preview": trans.get("translation_preview"),
    }


def main() -> int:
    result = asyncio.run(_run())
    output_file = Path("harness") / "gpt_realtime_latency_result.json"
    output_file.parent.mkdir(exist_ok=True)
    output_file.write_text(json.dumps(result, indent=2), encoding="utf-8")

    print("GPT Realtime Latency Result")
    print(json.dumps(result, indent=2))
    print(f"Saved: {output_file}")

    return 0 if result.get("status") == "SUCCESS" else 1


if __name__ == "__main__":
    sys.exit(main())
