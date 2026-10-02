"""Measure CDF pattern-mode tag detection without creating assets.

Reads one PDF and one TIFF already stored as CogniteFile nodes. The engineering
diagram detect API returns matches only; this script does not upsert instances.
Stdout contains counts and box statistics, never detected text.
"""

from __future__ import annotations

import json
import statistics
import sys
from typing import Any

from cognite.client.config import global_config
from cognite.client.data_classes.contextualization import FileReference
from cognite.client.data_classes.data_modeling import ViewId
from cognite.client.data_classes.data_modeling.ids import NodeId
from cognite_field_engineering import get_client

global_config.disable_pypi_version_check = True

ORG = "cog-brandon"
PROJECT = "brandon-cardinal-dev"
SPACE = "cardinal_samples"
FILE_VIEW = ViewId("cdf_cdm", "CogniteFile", "v1")
ASSET_VIEW = ViewId("cdf_cdm", "CogniteAsset", "v1")
ASSET_SPACES = (SPACE, "cardinal_ocr_candidates")
PATTERNS = (
    {"sample": "21PT1017", "pattern": "digits-letters-digits"},
    {"sample": "PT-101", "pattern": "letters-digits"},
    {"sample": "P-101A", "pattern": "equipment-with-suffix"},
    {"sample": "FV-101", "pattern": "valve"},
    {"sample": "LIC-1201", "pattern": "instrument-loop"},
)


def file_props(node: Any) -> dict[str, Any]:
    return node.properties.get(FILE_VIEW, {})


def choose_files(nodes: list[Any]) -> tuple[Any, Any]:
    pdfs = [
        node
        for node in nodes
        if str(file_props(node).get("mimeType", "")).lower() == "application/pdf"
        and node.external_id != "pump_tank_pid"
    ]
    tiffs = [
        node
        for node in nodes
        if str(file_props(node).get("mimeType", "")).lower() in {"image/tiff", "image/tif"}
    ]
    if not pdfs or not tiffs:
        raise SystemExit("Need one PDF and one TIFF CogniteFile in cardinal_samples.")
    return sorted(pdfs, key=lambda node: node.external_id)[0], sorted(tiffs, key=lambda node: node.external_id)[0]


def asset_count(client: Any, space: str) -> int:
    nodes = client.data_modeling.instances.list(
        instance_type="node",
        space=space,
        sources=ASSET_VIEW,
        limit=None,
    )
    return len(list(nodes))


def valid_box(annotation: dict[str, Any]) -> bool:
    region = annotation.get("region") or {}
    vertices = region.get("vertices") or []
    if not isinstance(vertices, list) or len(vertices) < 2:
        return False
    xs = [float(vertex["x"]) for vertex in vertices if isinstance(vertex, dict) and "x" in vertex]
    ys = [float(vertex["y"]) for vertex in vertices if isinstance(vertex, dict) and "y" in vertex]
    return bool(xs and ys and min(xs) < max(xs) and min(ys) < max(ys))


def length_bucket(length: int) -> str:
    if length <= 1:
        return "1"
    if length <= 4:
        return "2-4"
    if length <= 12:
        return "5-12"
    return "13+"


def summarize(annotations: list[dict[str, Any]]) -> dict[str, Any]:
    confidences = [
        float(annotation["confidence"])
        for annotation in annotations
        if isinstance(annotation.get("confidence"), int | float)
    ]
    buckets = {"1": 0, "2-4": 0, "5-12": 0, "13+": 0}
    for annotation in annotations:
        text = annotation.get("text")
        buckets[length_bucket(len(text) if isinstance(text, str) else 0)] += 1
    return {
        "detections": len(annotations),
        "validBoxes": sum(1 for annotation in annotations if valid_box(annotation)),
        "confidence": {
            "count": len(confidences),
            "min": min(confidences) if confidences else None,
            "median": statistics.median(confidences) if confidences else None,
            "max": max(confidences) if confidences else None,
        },
        "textLengthBuckets": buckets,
    }


def ocr_summary(client: Any, file_id: int | None) -> dict[str, Any]:
    if file_id is None:
        return {"words": 0, "validBoxes": 0, "textLengthBuckets": {}}
    response = client.post(
        f"/api/v1/projects/{client.config.project}/context/diagram/ocr",
        json={"fileId": file_id, "startPage": 1, "limit": 1},
        headers={"cdf-version": "20230101-beta"},
    )
    pages = response.json().get("items") or []
    annotations: list[dict[str, Any]] = []
    for page in pages:
        found = page.get("annotations") or []
        if isinstance(found, list):
            annotations.extend(
                {
                    "text": annotation.get("text"),
                    "region": {
                        "vertices": [
                            {"x": annotation.get("boundingBox", {}).get("xMin"), "y": annotation.get("boundingBox", {}).get("yMin")},
                            {"x": annotation.get("boundingBox", {}).get("xMax"), "y": annotation.get("boundingBox", {}).get("yMax")},
                        ]
                    },
                }
                for annotation in found
                if isinstance(annotation, dict)
            )
    summary = summarize(annotations)
    return {
        "words": summary["detections"],
        "validBoxes": summary["validBoxes"],
        "textLengthBuckets": summary["textLengthBuckets"],
    }


def detect_file(client: Any, node: Any, *, page_range: bool) -> dict[str, Any]:
    reference = FileReference(
        file_instance_id=NodeId(SPACE, node.external_id),
        first_page=1 if page_range else None,
        last_page=1 if page_range else None,
    )
    job = client.diagrams.detect(
        entities=list(PATTERNS),
        search_field="sample",
        partial_match=True,
        min_tokens=2,
        file_references=[reference] if page_range else None,
        file_instance_ids=None if page_range else [NodeId(SPACE, node.external_id)],
        pattern_mode=True,
    )
    result = job.result
    items = result.get("items", [])
    annotations: list[dict[str, Any]] = []
    errors: list[str] = []
    file_id: int | None = None
    for item in items:
        if item.get("fileId") is not None:
            file_id = int(item["fileId"])
        message = item.get("errorMessage")
        if message:
            errors.append(str(message)[:300])
        found = item.get("annotations") or item.get("matches") or []
        if isinstance(found, list):
            annotations.extend(annotation for annotation in found if isinstance(annotation, dict))
    props = file_props(node)
    return {
        "externalId": node.external_id,
        "mimeType": props.get("mimeType"),
        "pageRange": page_range,
        "jobId": job.job_id,
        "status": job.status,
        "errors": errors,
        "pattern": summarize(annotations),
        "ocr": ocr_summary(client, file_id),
    }


def main() -> None:
    client = get_client(org=ORG, project=PROJECT)
    before = {space: asset_count(client, space) for space in ASSET_SPACES}
    listed = client.data_modeling.instances.list(
        instance_type="node",
        space=SPACE,
        sources=FILE_VIEW,
        limit=None,
    )
    pdf, tiff = choose_files(list(listed))
    report = {
        "mode": "pattern",
        "writes": "none",
        "assetsBefore": before,
        "files": [
            detect_file(client, pdf, page_range=True),
            detect_file(client, tiff, page_range=False),
        ],
    }
    report["assetsAfter"] = {space: asset_count(client, space) for space in ASSET_SPACES}
    report["assetsUnchanged"] = report["assetsBefore"] == report["assetsAfter"]
    json.dump(report, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
