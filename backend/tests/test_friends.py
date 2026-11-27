ANA = {
    "first_name": "Ana",
    "last_name": "Kovač",
    "email": "Ana@Example.com",
    "address": "Main Street 1",
    "country": "Serbia",
    "mobile": "+381 60 123 4567",
}


def test_requires_login(client):
    assert client.get("/api/recipients").status_code == 401
    assert client.post("/api/recipients", json=ANA).status_code == 401


def test_create_list_update_delete(signed_in):
    r = signed_in.post("/api/recipients", json=ANA)
    assert r.status_code == 201
    created = r.get_json()
    assert created["email"] == "ana@example.com"  # normalised
    assert {k: created[k] for k in ANA if k != "email"} == {k: ANA[k] for k in ANA if k != "email"}

    assert [x["id"] for x in signed_in.get("/api/recipients").get_json()["items"]] == [created["id"]]
    assert signed_in.get(f"/api/recipients/{created['id']}").get_json() == created

    r = signed_in.put(f"/api/recipients/{created['id']}", json={**ANA, "country": "Croatia"})
    assert r.status_code == 200
    assert r.get_json()["country"] == "Croatia"

    r = signed_in.patch(f"/api/recipients/{created['id']}", json={"mobile": "123"})
    assert r.get_json()["mobile"] == "123"
    assert r.get_json()["first_name"] == "Ana"

    assert signed_in.delete(f"/api/recipients/{created['id']}").status_code == 204
    assert signed_in.get("/api/recipients").get_json()["items"] == []
    assert signed_in.get(f"/api/recipients/{created['id']}").status_code == 404


def test_only_first_name_and_email_are_required(signed_in):
    r = signed_in.post("/api/recipients", json={"first_name": "Bo", "email": "bo@example.com"})
    assert r.status_code == 201
    assert r.get_json()["last_name"] == ""


def test_validation(signed_in):
    def post(**changes):
        return signed_in.post("/api/recipients", json={**ANA, **changes})

    assert post(first_name="  ").status_code == 400
    assert post(email="not-an-email").status_code == 400
    assert post(email="").status_code == 400
    assert post(first_name="x" * 101).status_code == 400
    assert post(mobile=12345).status_code == 400
    assert signed_in.post("/api/recipients", json=["nope"]).status_code == 400
    assert signed_in.post("/api/recipients", data="nope").status_code == 400
    assert signed_in.get("/api/recipients").get_json()["items"] == []


def test_duplicate_email_is_rejected(signed_in):
    first = signed_in.post("/api/recipients", json=ANA).get_json()
    assert signed_in.post("/api/recipients", json={**ANA, "first_name": "Other"}).status_code == 409

    second = signed_in.post("/api/recipients", json={**ANA, "email": "b@example.com"}).get_json()
    r = signed_in.patch(f"/api/recipients/{second['id']}", json={"email": "ana@example.com"})
    assert r.status_code == 409
    # Saving a recipient with its own email is fine
    assert signed_in.put(f"/api/recipients/{first['id']}", json=ANA).status_code == 200


def test_sorted_by_name(signed_in):
    for name in ("Zoran", "ana", "Milan"):
        signed_in.post(
            "/api/recipients", json={"first_name": name, "email": f"{name}@example.com"}
        )
    names = [x["first_name"] for x in signed_in.get("/api/recipients").get_json()["items"]]
    assert names == sorted(names)


def test_users_cannot_see_or_change_each_others_recipients(signed_in, other):
    mine = signed_in.post("/api/recipients", json=ANA).get_json()

    assert other.get("/api/recipients").get_json()["items"] == []
    assert other.get(f"/api/recipients/{mine['id']}").status_code == 404
    assert other.put(f"/api/recipients/{mine['id']}", json=ANA).status_code == 404
    assert other.delete(f"/api/recipients/{mine['id']}").status_code == 404
    # The same address may exist in two users' lists
    assert other.post("/api/recipients", json=ANA).status_code == 201
    assert len(signed_in.get("/api/recipients").get_json()["items"]) == 1
