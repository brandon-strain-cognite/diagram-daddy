"""Start Diagram parsing tag detection on the seeded pump-tank P&ID.

Uses the cog-brandon service account and the beta Diagram parsing API.
Does not print the access token or the session nonce.
"""

from __future__ import annotations

import json
import sys
import time

import httpx
from cognite.client.config import global_config

from phase0_seed import BASE_URL, FILE_EXTERNAL_ID, PROJECT, SPACE, load_access_token

global_config.disable_pypi_version_check = True

GLOBAL_LIBRARY_ID = "global-3f656f67-8861-4869-a6fe-53416eb01faf"
LIBRARY_NAME = "Cardinal NORSOK Z-004"
BETA = "20230101-beta"


def headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "cdf-version": BETA,
        "content-type": "application/json",
        "accept": "application/json",
    }


def project_library_id(http: httpx.Client, base: str, token: str) -> str:
    listed = http.get(f"{base}/diagram-parsing/libraries", headers=headers(token))
    listed.raise_for_status()
    for item in listed.json().get("items", []):
        if item.get("name") == LIBRARY_NAME and item.get("scope") != "Global":
            return item["externalId"]
    copied = http.post(
        f"{base}/diagram-parsing/libraries/{GLOBAL_LIBRARY_ID}/copy",
        headers=headers(token),
        json={"name": LIBRARY_NAME},
    )
    if copied.status_code >= 400:
        raise SystemExit(f"library copy {copied.status_code}: {copied.text[:800]}")
    return copied.json()["externalId"]


def main() -> None:
    token = load_access_token()
    base = f"{BASE_URL}/api/v1/projects/{PROJECT}"
    with httpx.Client(timeout=180) as http:
        library_id = project_library_id(http, base, token)
        existing = http.get(f"{base}/diagram-parsing/diagrams", headers=headers(token))
        existing.raise_for_status()
        done = [
            item
            for item in existing.json().get("items", [])
            if item.get("fileId", {}).get("externalId") == FILE_EXTERNAL_ID
            and item.get("status") == "Success"
        ]
        if done:
            json.dump(
                {"libraryId": library_id, "diagrams": done, "alreadyParsed": True},
                sys.stdout,
                indent=2,
            )
            sys.stdout.write("\n")
            return
        session = http.post(
            f"{base}/sessions",
            headers={
                "Authorization": f"Bearer {token}",
                "content-type": "application/json",
                "accept": "application/json",
            },
            json={"items": [{"tokenExchange": True}]},
        )
        session.raise_for_status()
        nonce = session.json()["items"][0]["nonce"]
        body = {
            "documents": [
                {
                    "fileId": {"space": SPACE, "externalId": FILE_EXTERNAL_ID},
                    "pageNumber": 1,
                }
            ],
            "filters": {
                "Asset": {
                    "equals": {"property": ["node", "space"], "value": SPACE}
                },
                "File": {
                    "equals": {"property": ["node", "space"], "value": SPACE}
                },
            },
            "libraryId": library_id,
            "nonce": nonce,
            "partialMatch": True,
            "minTokens": 2,
            "searchField": "name",
        }
        started = http.post(
            f"{base}/diagram-parsing/parsing/full",
            headers=headers(token),
            json=body,
        )
        if started.status_code >= 400:
            message = started.text[:800]
            raise SystemExit(f"parse start {started.status_code}: {message}")
        payload = started.json()
        job_ids = payload.get("items", payload) if isinstance(payload, dict) else payload
        deadline = time.time() + 180
        diagrams: list[dict] = []
        open_states = {"InQueue", "InProgress", "Running", "Queued", "Pending"}
        while time.time() < deadline:
            listed = http.get(f"{base}/diagram-parsing/diagrams", headers=headers(token))
            listed.raise_for_status()
            diagrams = [
                item
                for item in listed.json().get("items", [])
                if item.get("fileId", {}).get("externalId") == FILE_EXTERNAL_ID
            ]
            if diagrams and all(item.get("status") not in open_states for item in diagrams):
                break
            time.sleep(5)
        summary = {
            "libraryId": library_id,
            "jobIds": job_ids,
            "diagramCount": len(diagrams),
            "diagrams": [
                {
                    "externalId": item.get("externalId"),
                    "fileId": item.get("fileId"),
                    "status": item.get("status"),
                    "libraryId": item.get("libraryId"),
                    "pageNumber": item.get("pageNumber"),
                }
                for item in diagrams[:5]
            ],
        }
        json.dump(summary, sys.stdout, indent=2)
        sys.stdout.write("\n")


if __name__ == "__main__":
    main()
