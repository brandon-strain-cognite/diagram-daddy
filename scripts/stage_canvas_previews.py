"""Store a Canvas-ready PNG for each TIFF page that has review candidates.

CDF diagram convert rasterizes the TIFF. The PNG is uploaded as its own
CogniteFile. Boxes stay in the review candidates; they are not drawn into the
image. Approval will later write CogniteDiagramAnnotation on this PNG.

Stdout is counts and file ids only.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.request
from typing import Any

from cognite.client.config import global_config
from cognite.client.data_classes.data_modeling import ViewId
from cognite.client.data_classes.data_modeling.cdm.v1 import CogniteFileApply
from cognite_field_engineering import get_client

global_config.disable_pypi_version_check = True

ORG = "cog-brandon"
PROJECT = "brandon-cardinal-dev"
FILE_SPACE = "cardinal_samples"
REVIEW_SPACE = "cardinal_review"
FILE_VIEW = ViewId("cdf_cdm", "CogniteFile", "v1")
REVIEW_VIEW = ViewId("cardinal_diagram_review", "DiagramReviewCandidate", "v1")
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def canvas_preview_external_id(file_external_id: str, page: int) -> str:
    return f"{file_external_id}__canvas_p{page}"


def view_props(node: Any, view: ViewId) -> dict[str, Any]:
    properties = node.properties.get(view, {})
    return properties if isinstance(properties, dict) else {}


def is_tiff(mime_type: str) -> bool:
    return mime_type.lower() in {"image/tiff", "image/tif"}


def pages_for(client: Any) -> dict[str, set[int]]:
    pages: dict[str, set[int]] = {}
    listed = client.data_modeling.instances.list(
        instance_type="node",
        space=REVIEW_SPACE,
        sources=[REVIEW_VIEW],
        limit=None,
    )
    for node in listed:
        props = view_props(node, REVIEW_VIEW)
        external_id = props.get("fileExternalId")
        page = props.get("page")
        if isinstance(external_id, str) and isinstance(page, int | float) and not isinstance(page, bool):
            page_number = int(page)
            if page_number >= 1:
                pages.setdefault(external_id, set()).add(page_number)
    return pages


def tiff_sources(client: Any, wanted: dict[str, set[int]]) -> list[dict[str, Any]]:
    listed = client.data_modeling.instances.list(
        instance_type="node",
        space=FILE_SPACE,
        sources=[FILE_VIEW],
        limit=None,
    )
    sources = []
    for node in listed:
        if node.external_id not in wanted:
            continue
        props = view_props(node, FILE_VIEW)
        mime_type = str(props.get("mimeType") or "")
        if not is_tiff(mime_type):
            continue
        sources.append(
            {
                "externalId": node.external_id,
                "name": str(props.get("name") or node.external_id),
                "pages": sorted(wanted[node.external_id]),
            }
        )
    return sources


def existing_previews(client: Any) -> set[str]:
    listed = client.data_modeling.instances.list(
        instance_type="node",
        space=FILE_SPACE,
        sources=[FILE_VIEW],
        limit=None,
    )
    ready: set[str] = set()
    for node in listed:
        props = view_props(node, FILE_VIEW)
        if props.get("mimeType") == "image/png" and props.get("isUploaded") is True:
            ready.add(node.external_id)
    return ready


def project_path(client: Any, path: str) -> str:
    return f"/api/v1/projects/{client.config.project}{path}"


def convert_pages(client: Any, external_id: str) -> list[dict[str, Any]]:
    started = client.post(
        project_path(client, "/context/diagram/convert"),
        json={
            "items": [
                {
                    "fileInstanceId": {"space": FILE_SPACE, "externalId": external_id},
                    "annotations": [],
                }
            ]
        },
    )
    job_id = started.json()["jobId"]
    deadline = time.monotonic() + 600
    body: dict[str, Any] = {}
    while time.monotonic() < deadline:
        body = client.get(project_path(client, f"/context/diagram/convert/{job_id}")).json()
        status = body.get("status")
        if status in {"Completed", "Failed"}:
            break
        time.sleep(3)
    if body.get("status") != "Completed":
        raise SystemExit(f"Convert did not complete for {external_id}: {body.get('status')}")
    pages: list[dict[str, Any]] = []
    for item in body.get("items", []):
        for result in item.get("results") or []:
            page = result.get("page")
            png_url = result.get("pngUrl")
            if isinstance(page, int) and isinstance(png_url, str):
                pages.append({"page": page, "pngUrl": png_url})
    return pages


def png_bytes(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=120) as response:
        payload = response.read()
    if not payload.startswith(PNG_MAGIC):
        raise SystemExit("Diagram convert did not return a PNG.")
    return payload


def upload_preview(client: Any, source_external_id: str, source_name: str, page: int, payload: bytes) -> str:
    external_id = canvas_preview_external_id(source_external_id, page)
    stem = source_name.rsplit(".", 1)[0]
    client.data_modeling.files.upload_bytes(
        payload,
        CogniteFileApply(
            space=FILE_SPACE,
            external_id=external_id,
            name=f"{stem} page {page}.png",
            description=(
                f"Canvas-ready PNG of {FILE_SPACE}/{source_external_id} page {page}. "
                "Produced by CDF diagram convert. Review boxes use the same 0-1 coordinates "
                "and are written later as CogniteDiagramAnnotation on this file."
            ),
            mime_type="image/png",
            directory="canvas-previews",
            source_id=source_external_id,
            source_context=f"{FILE_SPACE}:page:{page}",
            tags=["canvas-preview"],
        ),
    )
    return external_id


def main() -> None:
    client = get_client(org=ORG, project=PROJECT)
    wanted = pages_for(client)
    ready = existing_previews(client)
    summary = []
    for source in tiff_sources(client, wanted):
        missing = [page for page in source["pages"] if canvas_preview_external_id(source["externalId"], page) not in ready]
        created = []
        if missing:
            converted = {page["page"]: page["pngUrl"] for page in convert_pages(client, source["externalId"])}
            for page in missing:
                url = converted.get(page)
                if url is None:
                    raise SystemExit(f"No PNG for {source['externalId']} page {page}.")
                payload = png_bytes(url)
                created.append(
                    {
                        "page": page,
                        "externalId": upload_preview(client, source["externalId"], source["name"], page, payload),
                        "bytes": len(payload),
                    }
                )
        summary.append(
            {
                "source": source["externalId"],
                "pages": source["pages"],
                "created": created,
                "alreadyReady": [
                    canvas_preview_external_id(source["externalId"], page)
                    for page in source["pages"]
                    if page not in missing
                ],
            }
        )
    json.dump({"previews": summary}, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
