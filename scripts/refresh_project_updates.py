"""Record the latest successful Pages publication for each project linked in the portal."""

import hashlib
import json
import os
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import Request, urlopen


OWNER = "seiryu1318"
EXCLUDED = {"26early_ryan", "26early_ryanm", "ergosphere_ryan"}
ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "project-updates.json"


class ProjectLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.projects = {}

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        project = attrs.get("data-project")
        if tag != "a" or not project:
            return
        url = urlsplit(attrs.get("href") or "")
        if url.scheme != "https" or url.hostname != f"{OWNER}.github.io":
            return
        repo, _, path = url.path.lstrip("/").partition("/")
        if not re.fullmatch(r"[A-Za-z0-9_-]+", repo) or repo.lower() in EXCLUDED:
            return
        self.projects.setdefault(project, {}).setdefault(repo, set()).add(path)


def github(repo, endpoint, optional=False):
    url = f"https://api.github.com/repos/{OWNER}/{repo}/{endpoint}"
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "admissions-portal-updates"}
    if token := os.environ.get("GH_TOKEN"):
        headers["Authorization"] = f"Bearer {token}"
    try:
        with urlopen(Request(url, headers=headers), timeout=20) as response:
            return json.load(response)
    except HTTPError as error:
        if optional and error.code in {403, 404} and error.headers.get("X-RateLimit-Remaining") != "0":
            return None
        raise


def verified_commit_time(repo, paths):
    # When deployment history is unavailable, only use a commit whose file
    # matches the public page byte for byte. An unpublished push must not count.
    dates = []
    for path in sorted(paths):
        live_path = path if path and not path.endswith("/") else path + "index.html"
        with urlopen(f"https://{OWNER}.github.io/{repo}/{quote(live_path)}", timeout=20) as response:
            content = response.read()
        blob = hashlib.sha1(f"blob {len(content)}\0".encode() + content).hexdigest()
        for source_path in [live_path, "docs/" + live_path]:
            commits = github(repo, "commits?" + urlencode({"path": source_path, "per_page": 1}))
            if not commits:
                continue
            commit = commits[0]
            file = github(repo, f"contents/{quote(source_path)}?ref={commit['sha']}", optional=True)
            if file and file.get("sha") == blob:
                dates.append(commit["commit"]["committer"]["date"])
                break
    return max(dates, default=None)


def publication_time(repo, paths):
    deployments = github(repo, "deployments?environment=github-pages&per_page=20", optional=True)
    for deployment in deployments or []:
        statuses = github(repo, f"deployments/{deployment['id']}/statuses?per_page=100")
        for status in statuses:
            if status["state"] == "success":
                return status["created_at"]
    builds = github(repo, "pages/builds?per_page=30", optional=True)
    for build in builds or []:
        if build["status"] == "built":
            return build["updated_at"]
    return verified_commit_time(repo, paths)


def main():
    links = ProjectLinks()
    links.feed((ROOT / "index.html").read_text(encoding="utf-8"))
    if not links.projects:
        raise RuntimeError("No linked Pages projects found")
    previous = json.loads(MANIFEST.read_text(encoding="utf-8"))["projects"] if MANIFEST.exists() else {}
    projects = {}
    failures = []
    for project, repos in links.projects.items():
        dates = [previous[project]] if project in previous else []
        for repo, paths in repos.items():
            try:
                date = publication_time(repo, paths)
                if not date:
                    raise ValueError("no verifiable publication")
                dates.append(date)
            except (HTTPError, URLError, TimeoutError, ValueError, OSError) as error:
                failures.append(f"{repo}: {error}")
        if dates:
            projects[project] = max(dates)
    if failures:
        # Still publish verified updates for the other projects and retain the
        # affected projects' last-known dates. Report partial checks in Actions.
        for failure in failures:
            print(f"::warning::{failure}", file=sys.stderr)
        if len(failures) == sum(len(repos) for repos in links.projects.values()):
            raise RuntimeError("Every repository check failed")
    if projects != previous:
        MANIFEST.write_text(json.dumps({"projects": projects}, indent=2, sort_keys=True) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
