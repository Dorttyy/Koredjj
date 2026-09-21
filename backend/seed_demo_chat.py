import os
import requests

BASE = os.environ.get("BACKEND_URL", "http://localhost:8001").rstrip("/") + "/api"


def reg_or_login(email, name, pw="Demo1234!"):
    r = requests.post(f"{BASE}/auth/register", json={"email": email, "password": pw, "name": name})
    if r.status_code == 201:
        return r.json()["token"], r.json()["user"]["id"]
    # already exists -> login
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": pw})
    r.raise_for_status()
    d = r.json()
    return d["token"], d["user"]["id"]


def main():
    mei_tok, mei_id = reg_or_login("mei@demo.com", "Mei Lin")
    han_tok, han_id = reg_or_login("han@demo.com", "han")
    print("mei", mei_id, "han", han_id)

    H = lambda t: {"Authorization": f"Bearer {t}"}

    # Create conversation mei <-> han
    r = requests.post(f"{BASE}/chats", json={"partner_id": han_id}, headers=H(mei_tok))
    r.raise_for_status()
    cid = r.json()["id"]
    print("conversation", cid)

    def send(tok, text):
        rr = requests.post(f"{BASE}/chats/{cid}/messages", json={"text": text}, headers=H(tok))
        print("send", rr.status_code, text)

    send(mei_tok, "Ohh")
    send(mei_tok, "Thanks")
    send(han_tok, "Your welcome")

    print("DONE")


if __name__ == "__main__":
    main()
