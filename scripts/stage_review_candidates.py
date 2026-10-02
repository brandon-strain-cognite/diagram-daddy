"""Deploy the review-candidate view and fill it from CDF pattern detection.

Creates no CogniteAsset or CogniteDiagramAnnotation nodes. Prints counts only.
"""

from __future__ import annotations

import json
import sys
from typing import Any

from cognite.client.config import global_config
from cognite.client.data_classes.data_modeling import (
    ContainerApply,
    ContainerId,
    ContainerProperty,
    DataModelApply,
    MappedPropertyApply,
    NodeApply,
    NodeOrEdgeData,
    SpaceApply,
    ViewApply,
    ViewId,
)
from cognite.client.data_classes.data_modeling.data_types import Float64, Int64, Text
from cognite.client.data_classes.data_modeling.ids import NodeId
from cognite_field_engineering import get_client

global_config.disable_pypi_version_check = True

ORG = "cog-brandon"
PROJECT = "brandon-cardinal-dev"
SCHEMA_SPACE = "cardinal_diagram_review"
INSTANCE_SPACE = "cardinal_review"
CONTAINER_ID = "DiagramReviewCandidate"
VIEW_ID = ViewId(SCHEMA_SPACE, CONTAINER_ID, "v1")
FILE_SPACE = "cardinal_samples"
PATTERNS = (
    {"sample": "21PT1017"},
    {"sample": "PT-101"},
    {"sample": "P-101A"},
    {"sample": "FV-101"},
    {"sample": "LIC-1201"},
)
DRAWINGS = (
    {"external_id": "cdp_1_coc_5007_5", "page_range": True},
    {"external_id": "cdp_1-2_aep_5006_16", "page_range": False},
)


def imul(left: int, right: int) -> int:
    value = (left * right) & 0xFFFFFFFF
    if value >= 0x80000000:
        value -= 0x100000000
    return value


def candidate_external_id(file_external_id: str, text: str, page: int, box: dict[str, float]) -> str:
    raw = "\u001f".join(
        [
            FILE_SPACE,
            file_external_id,
            str(page),
            text,
            str(box["xMin"]),
            str(box["yMin"]),
            str(box["xMax"]),
            str(box["yMax"]),
        ]
    )
    high = 2166136261
    low = 2166136261 ^ 0x9E3779B9
    for character in raw:
        code = ord(character)
        high = imul(high ^ code, 16777619)
        low = imul(low ^ code, 2246822519)
    return f"c{high & 0xFFFFFFFF:08x}{low & 0xFFFFFFFF:08x}"


def round_box(box: dict[str, float]) -> dict[str, float]:
    return {key: round(value, 4) for key, value in box.items()}


def box_from_annotation(annotation: dict[str, Any]) -> dict[str, float] | None:
    bounds = annotation.get("boundingBox")
    if isinstance(bounds, dict):
        box = {
            "xMin": float(bounds["xMin"]),
            "yMin": float(bounds["yMin"]),
            "xMax": float(bounds["xMax"]),
            "yMax": float(bounds["yMax"]),
        }
    else:
        vertices = (annotation.get("region") or {}).get("vertices") or []
        xs = [float(vertex["x"]) for vertex in vertices if isinstance(vertex, dict) and "x" in vertex]
        ys = [float(vertex["y"]) for vertex in vertices if isinstance(vertex, dict) and "y" in vertex]
        if len(xs) < 2 or len(ys) < 2:
            return None
        box = {"xMin": min(xs), "yMin": min(ys), "xMax": max(xs), "yMax": max(ys)}
    if box["xMin"] < 0 or box["yMin"] < 0 or box["xMax"] > 1 or box["yMax"] > 1:
        return None
    if box["xMin"] >= box["xMax"] or box["yMin"] >= box["yMax"]:
        return None
    return round_box(box)


def deploy_schema(client: Any) -> None:
    description = "Untrusted diagram text pending human review."
    client.data_modeling.spaces.apply(
        [
            SpaceApply(SCHEMA_SPACE, name="Cardinal diagram review", description="Schema for untrusted diagram review."),
            SpaceApply(INSTANCE_SPACE, name="Cardinal review", description="Pending diagram review candidates."),
        ]
    )
    properties = {
        "fileSpace": ContainerProperty(Text(), nullable=False, description="Space of the source CogniteFile."),
        "fileExternalId": ContainerProperty(Text(), nullable=False, description="External ID of the source CogniteFile."),
        "page": ContainerProperty(Int64(), nullable=False, description="One-based page number."),
        "text": ContainerProperty(Text(), nullable=False, description="Detected text."),
        "xMin": ContainerProperty(Float64(), nullable=False, description="Left edge, normalized from 0 to 1."),
        "yMin": ContainerProperty(Float64(), nullable=False, description="Top edge, normalized from 0 to 1."),
        "xMax": ContainerProperty(Float64(), nullable=False, description="Right edge, normalized from 0 to 1."),
        "yMax": ContainerProperty(Float64(), nullable=False, description="Bottom edge, normalized from 0 to 1."),
        "confidence": ContainerProperty(Float64(), nullable=True, description="CDF detection confidence from 0 to 1."),
        "source": ContainerProperty(Text(), nullable=False, description="cdf-pattern, cdf-ocr, or manual."),
        "decision": ContainerProperty(Text(), nullable=False, description="Review decision. New records are pending."),
    }
    container = ContainerApply(
        space=SCHEMA_SPACE,
        external_id=CONTAINER_ID,
        name="Diagram review candidate",
        description=description,
        used_for="node",
        properties=properties,
    ).dump()
    for prop in container["properties"].values():
        prop.pop("constraintState", None)
        prop.pop("autoIncrement", None)
        prop.pop("immutable", None)
    client.post(
        f"/api/v1/projects/{client.config.project}/models/containers",
        json={"items": [container]},
    )
    container = ContainerId(SCHEMA_SPACE, CONTAINER_ID)
    client.data_modeling.views.apply(
        ViewApply(
            space=SCHEMA_SPACE,
            external_id=CONTAINER_ID,
            version="v1",
            name="Diagram review candidate",
            description=description,
            properties={
                key: MappedPropertyApply(container, key, description=prop.description)
                for key, prop in properties.items()
            },
        )
    )
    client.data_modeling.data_models.apply(
        DataModelApply(
            space=SCHEMA_SPACE,
            external_id="DiagramReview_SOL",
            version="v1",
            name="Diagram review",
            description="Untrusted candidates produced from engineering drawings.",
            views=[VIEW_ID],
        )
    )


def detections_for(client: Any, external_id: str, page_range: bool) -> list[dict[str, Any]]:
    from cognite.client.data_classes.contextualization import FileReference

    reference = FileReference(
        file_instance_id=NodeId(FILE_SPACE, external_id),
        first_page=1 if page_range else None,
        last_page=1 if page_range else None,
    )
    job = client.diagrams.detect(
        entities=list(PATTERNS),
        search_field="sample",
        partial_match=True,
        min_tokens=2,
        file_references=[reference] if page_range else None,
        file_instance_ids=None if page_range else [NodeId(FILE_SPACE, external_id)],
        pattern_mode=True,
    )
    annotations: list[dict[str, Any]] = []
    for item in job.result.get("items", []):
        found = item.get("annotations") or []
        if isinstance(found, list):
            annotations.extend(annotation for annotation in found if isinstance(annotation, dict))
    return annotations


def nodes_for(external_id: str, annotations: list[dict[str, Any]]) -> list[NodeApply]:
    nodes: list[NodeApply] = []
    seen: set[str] = set()
    for annotation in annotations:
        text = str(annotation.get("text") or "").strip()
        box = box_from_annotation(annotation)
        if not text or not box:
            continue
        page = int((annotation.get("region") or {}).get("page") or 1)
        external = candidate_external_id(external_id, text, page, box)
        if external in seen:
            continue
        seen.add(external)
        confidence = annotation.get("confidence")
        properties: dict[str, Any] = {
            "fileSpace": FILE_SPACE,
            "fileExternalId": external_id,
            "page": page,
            "text": text,
            **box,
            "source": "cdf-pattern",
            "decision": "pending",
        }
        if isinstance(confidence, int | float) and 0 <= float(confidence) <= 1:
            properties["confidence"] = float(confidence)
        nodes.append(
            NodeApply(
                space=INSTANCE_SPACE,
                external_id=external,
                sources=[NodeOrEdgeData(source=VIEW_ID, properties=properties)],
            )
        )
    return nodes


def main() -> None:
    client = get_client(org=ORG, project=PROJECT)
    before = len(list(client.data_modeling.instances.list(instance_type="node", space=FILE_SPACE, sources=[ViewId("cdf_cdm", "CogniteAsset", "v1")], limit=None)))
    deploy_schema(client)
    summary = []
    for drawing in DRAWINGS:
        annotations = detections_for(client, drawing["external_id"], bool(drawing["page_range"]))
        nodes = nodes_for(drawing["external_id"], annotations)
        if nodes:
            client.data_modeling.instances.apply(nodes)
        summary.append({"externalId": drawing["external_id"], "candidates": len(nodes)})
    after = len(list(client.data_modeling.instances.list(instance_type="node", space=FILE_SPACE, sources=[ViewId("cdf_cdm", "CogniteAsset", "v1")], limit=None)))
    json.dump({"drawings": summary, "assetsBefore": before, "assetsAfter": after, "assetsUnchanged": before == after}, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
