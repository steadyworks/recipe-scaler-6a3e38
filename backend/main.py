import uuid
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)

CORS(app, resources={r"/*": {
    "origins": "*",
    "allow_headers": ["Content-Type", "X-Session-ID"],
    "methods": ["GET", "POST", "DELETE", "OPTIONS"],
    "supports_credentials": False,
}})

# In-memory store: session_id -> list of recipes
_store: dict = {}


def _get_sid() -> str:
    return request.headers.get("X-Session-ID", "default")


def _get_recipes() -> list:
    return _store.setdefault(_get_sid(), [])


@app.route("/recipes", methods=["GET"])
def list_recipes():
    return jsonify(_get_recipes())


@app.route("/recipes", methods=["POST"])
def create_recipe():
    data = request.get_json(force=True) or {}
    recipe = {
        "id": str(uuid.uuid4()),
        "title": data.get("title", ""),
        "baseServings": data.get("baseServings", 1),
        "ingredients": data.get("ingredients", []),
    }
    _get_recipes().append(recipe)
    return jsonify(recipe), 201


@app.route("/recipes/<rid>", methods=["DELETE"])
def delete_recipe(rid):
    sid = _get_sid()
    if sid in _store:
        _store[sid] = [r for r in _store[sid] if r["id"] != rid]
    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=3001, debug=False)
