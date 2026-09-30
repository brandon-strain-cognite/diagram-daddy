"""Phase 0: put one public-domain vector P&ID into CDF for Diagram parsing.

Fusion path after this script:
Data fusion → Contextualize → Diagram parsing, on the project default location.
The named location "Cardinal samples" was not created; /locations returns 404 here.

Auth is the cog-brandon service account (client credentials). The script does not print the token.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from cognite.client.config import global_config

global_config.disable_pypi_version_check = True

from cognite.client import CogniteClient
from cognite.client.data_classes.data_modeling import SpaceApply
from cognite_field_engineering import get_client
from cognite.client.data_classes.data_modeling.cdm.v1 import (
    CogniteAssetApply,
    CogniteFile,
    CogniteFileApply,
)

PROJECT = "brandon-cardinal-dev"
BASE_URL = "https://orangefield.cognitedata.com"
ORG = "cog-brandon"
SPACE = "cardinal_samples"
FILE_EXTERNAL_ID = "pump_tank_pid"
PDF = (
    Path(__file__).resolve().parents[1]
    / "sample-pids"
    / "public-domain-samples"
    / "01_pump_tank_PID_vector.pdf"
)
def client() -> CogniteClient:
    return get_client(org=ORG, project=PROJECT)


def load_access_token() -> str:
    _name, value = client().config.credentials.authorization_header()
    prefix = "Bearer "
    if not value.startswith(prefix):
        raise SystemExit("Service account did not return a bearer token.")
    return value[len(prefix):]


def ensure_space(cdf: CogniteClient) -> None:
    cdf.data_modeling.spaces.apply(
        SpaceApply(
            space=SPACE,
            name="Cardinal samples",
            description="Public-domain engineering drawings for diagram parsing tests.",
        )
    )


def ensure_file(cdf: CogniteClient) -> None:
    cdf.data_modeling.files.upload_bytes(
        PDF.read_bytes(),
        CogniteFileApply(
            space=SPACE,
            external_id=FILE_EXTERNAL_ID,
            name="Pump tank P&ID",
            description="Public-domain vector sample. Tags include T001 and P001.",
            mime_type="application/pdf",
            directory="public-domain-samples",
            tags=["pid", "vector", "sample"],
        ),
    )


def ensure_assets(cdf: CogniteClient) -> None:
    cdf.data_modeling.instances.apply(
        [
            CogniteAssetApply(
                space=SPACE,
                external_id="T001",
                name="T001",
                description="Storage tank. Plant master, not a drawing label.",
                aliases=[],
                tags=["sample", "plant"],
            ),
            CogniteAssetApply(
                space=SPACE,
                external_id="P001",
                name="P001",
                description="Feed pump. Plant master, not a drawing label.",
                aliases=[],
                tags=["sample", "plant"],
            ),
        ]
    )


def main() -> None:
    if not PDF.is_file():
        raise SystemExit(f"Missing sample PDF: {PDF}")
    cdf = client()
    ensure_space(cdf)
    ensure_file(cdf)
    ensure_assets(cdf)
    file_node = cdf.data_modeling.instances.retrieve(
        nodes=(SPACE, FILE_EXTERNAL_ID),
        sources=CogniteFile.get_source(),
    )
    uploaded = None
    if file_node.nodes:
        uploaded = file_node.nodes[0].properties.get(CogniteFile.get_source(), {}).get("isUploaded")
    summary = {
        "project": PROJECT,
        "space": SPACE,
        "file": FILE_EXTERNAL_ID,
        "isUploaded": uploaded,
        "assets": ["T001", "P001"],
    }
    json.dump(summary, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
