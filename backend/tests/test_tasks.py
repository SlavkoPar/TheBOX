def test_requires_login(client):
    assert client.get("/api/tasks").status_code == 401


def test_create_and_defaults(signed_in):
    r = signed_in.post("/api/tasks", json={"title": "  Buy milk "})
    assert r.status_code == 201
    task = r.get_json()
    assert task["title"] == "Buy milk"
    assert task["notes"] == ""
    assert task["due_date"] is None
    assert task["is_done"] is False
    assert task["completed_at"] is None


def test_validation(signed_in):
    assert signed_in.post("/api/tasks", json={}).status_code == 400
    assert signed_in.post("/api/tasks", json={"title": ""}).status_code == 400
    assert signed_in.post("/api/tasks", json={"title": "x", "due_date": "tomorrow"}).status_code == 400
    assert signed_in.post("/api/tasks", json={"title": "x", "is_done": "yes"}).status_code == 400


def test_complete_and_reopen(signed_in):
    task = signed_in.post("/api/tasks", json={"title": "Call Ana", "due_date": "2026-12-01"}).get_json()

    done = signed_in.patch(f"/api/tasks/{task['id']}", json={"is_done": True}).get_json()
    assert done["is_done"] is True
    assert done["completed_at"] is not None
    assert done["title"] == "Call Ana"
    assert done["due_date"] == "2026-12-01"

    reopened = signed_in.patch(f"/api/tasks/{task['id']}", json={"is_done": False}).get_json()
    assert reopened["is_done"] is False
    assert reopened["completed_at"] is None


def test_put_replaces_and_can_clear_due_date(signed_in):
    task = signed_in.post("/api/tasks", json={"title": "A", "due_date": "2026-12-01", "notes": "n"}).get_json()
    r = signed_in.put(f"/api/tasks/{task['id']}", json={"title": "B", "due_date": None})
    assert r.status_code == 200
    assert r.get_json()["title"] == "B"
    assert r.get_json()["due_date"] is None
    assert r.get_json()["notes"] == ""


def test_order_open_first_then_by_due_date(signed_in):
    def add(title, **extra):
        return signed_in.post("/api/tasks", json={"title": title, **extra}).get_json()

    add("no date")
    add("later", due_date="2026-12-20")
    add("sooner", due_date="2026-12-05")
    finished = add("finished", due_date="2026-12-01")
    signed_in.patch(f"/api/tasks/{finished['id']}", json={"is_done": True})

    titles = [t["title"] for t in signed_in.get("/api/tasks").get_json()["items"]]
    assert titles == ["sooner", "later", "no date", "finished"]


def test_delete_and_isolation(signed_in, other):
    task = signed_in.post("/api/tasks", json={"title": "Mine"}).get_json()

    assert other.get("/api/tasks").get_json()["items"] == []
    assert other.patch(f"/api/tasks/{task['id']}", json={"is_done": True}).status_code == 404
    assert other.delete(f"/api/tasks/{task['id']}").status_code == 404

    assert signed_in.delete(f"/api/tasks/{task['id']}").status_code == 204
    assert signed_in.delete(f"/api/tasks/{task['id']}").status_code == 404
