"""Prompt-injection scanner: multilingual heuristic (en/fr/pt/it) with an optional transformers checkpoint."""
import logging
import os
import re
import unicodedata

log = logging.getLogger("cosign.scanner")

LABELS = ("BENIGN", "JAILBREAK", "PROMPT_INJECTION")
HEURISTIC_MODEL = "heuristic-v1"

_STOPWORDS = {
    "en": "the and to of is are you your this that with for from all previous instructions role please",
    "fr": "les des est sans etre fais semblant service repond depuis une pour dans vous votre que avec precedentes precedent instructions le la et du au sur",
    "pt": "o os as uma sem finja servico apos respondeu pagamentos normalmente restricoes um para voce seu que com anteriores instrucoes cargo papel da do em nao ao",
    "it": "fai finta essere senza restrizioni gli della il lo una per tuo che con precedenti istruzioni ruolo di del nel non al e",
}
_STOP = {k: set(v.split()) for k, v in _STOPWORDS.items()}

_W = r"(?:\w+\W+){0,4}?"
_INJECTION = {
    "ignore_instructions": re.compile(
        r"\b(?:ignore|ignores|ignorez|ignorer|ignora|ignorar|ignorare|ignori|disregard|forget|override|"
        r"oubliez|oublie|esqueca|esquecer|dimentica|dimenticare)\W+" + _W +
        r"(?:instructions?|instrucoes|instrucciones|istruzioni|consignes|directives|directrices|rules|regles|regras|"
        r"regole|prompts?)\b"),
    "grant_admin": re.compile(
        r"\b(?:grant|give|assign|elevate|promote|accordez|accorder|donnez|attribuez|octroyez|"
        r"conceda|conceder|concedi|dar|atribua|atribuir|assegna|assegni|dai|concedere)\W+" + _W +
        r"(?:admin|administrator|administrateur|administrador|amministratore|root|realm-admin|superuser)\b"),
    "export_data": re.compile(
        r"\b(?:export|exports|exportez|exporter|exporta|exportar|esporta|esportare|dump|exfiltrate|leak|"
        r"envoyez|envie|invia|divulga|divulguez)\W+" + _W +
        r"(?:users?|utilisateurs|usuarios|utenti|table|tabela|tabella|customers?|clients?|clientes|database|"
        r"data|dados|dati|donnees|records?)\b"),
}
_JAILBREAK = {
    "persona": re.compile(
        r"\b(?:you are now|act as|pretend (?:to be|you)|role-?play|from now on you|vous etes maintenant|"
        r"fais semblant|faites comme si|jeu de role|voce agora e|finja|finge|fingir|ora sei|fai finta|"
        r"faccia finta|gioco di ruolo|jogo de papeis)\b"),
    "dan": re.compile(r"\b(?:dan|do anything now|developer mode|mode developpeur|modo desenvolvedor|"
                      r"modalita sviluppatore|jailbreak)\b"),
    "no_limits": re.compile(
        r"\b(?:without (?:any )?(?:restrictions|limits|filters)|no (?:restrictions|limits|rules)|"
        r"sans (?:restrictions?|limites|filtres)|sem (?:restricoes|limites|filtros)|"
        r"senza (?:restrizioni|limiti|filtri)|bypass (?:your |the )?(?:safety|filters|guardrails)|"
        r"contourne\w* (?:vos |les )?(?:filtres|regles|garde-fous)|ignore (?:your )?safety)\b"),
}

_model = None
_model_failed = False


def _fold(text: str) -> str:
    text = unicodedata.normalize("NFKD", text.lower())
    return "".join(c for c in text if not unicodedata.combining(c))


def detect_lang(text: str) -> str:
    words = re.findall(r"[a-z]+", _fold(text))
    scores = {k: sum(1 for w in words if w in s) for k, s in _STOP.items()}
    best = max(scores, key=lambda k: (scores[k], k == "en"))
    return best if scores[best] > 0 else "en"


def _result(label: str, score: float, lang: str, model: str, scores: dict, matched: list[str]) -> dict:
    return {"label": label, "score": round(score, 2), "lang": lang, "model": model,
            "scores": {k: round(scores.get(k, 0.0), 2) for k in LABELS}, "matched": matched}


def _heuristic(text: str, lang: str | None) -> dict:
    lang = lang or detect_lang(text)
    folded = _fold(text)
    inj = [n for n, p in _INJECTION.items() if p.search(folded)]
    jb = [n for n, p in _JAILBREAK.items() if p.search(folded)]
    inj_score = 0.0 if not inj else 0.97 if len(inj) >= 2 else 0.78
    jb_score = 0.0 if not jb else 0.96 if len(jb) >= 2 else 0.88
    if not inj and not jb:
        return _result("BENIGN", 0.97, lang, HEURISTIC_MODEL,
                       {"BENIGN": 0.97, "JAILBREAK": 0.01, "PROMPT_INJECTION": 0.02}, [])
    if inj_score >= jb_score:
        label, score, matched = "PROMPT_INJECTION", inj_score, inj
    else:
        label, score, matched = "JAILBREAK", jb_score, jb
    rest = round(1 - score, 2)
    scores = {k: round(rest * 0.4, 2) for k in LABELS}
    scores["BENIGN"] = round(rest * 0.2, 2)
    scores[label] = score
    return _result(label, score, lang, HEURISTIC_MODEL, scores, matched)


def _load_model(path: str):
    global _model, _model_failed
    if _model is not None or _model_failed:
        return _model
    try:
        from transformers import pipeline  # optional heavy dependency, not in requirements.txt
        _model = pipeline("text-classification", model=path, top_k=None)
    except Exception as exc:
        _model_failed = True
        log.warning("SCAN_MODE=model but cannot load checkpoint %r (%s); falling back to heuristic", path, exc)
    return _model


def _model_scan(text: str, lang: str | None, path: str) -> dict | None:
    clf = _load_model(path)
    if clf is None:
        return None
    try:
        out = clf(text, truncation=True)
        out = out[0] if out and isinstance(out[0], list) else out
        scores = {str(o["label"]).upper(): float(o["score"]) for o in out}
        if not set(LABELS) & set(scores):
            raise ValueError(f"unexpected labels {sorted(scores)}")
        label = max(LABELS, key=lambda k: scores.get(k, 0.0))
        return _result(label, scores.get(label, 0.0), lang or detect_lang(text),
                       os.path.basename(path.rstrip("/")) or "model", scores, [])
    except Exception as exc:
        log.warning("model inference failed (%s); falling back to heuristic", exc)
        return None


def scan_text(text: str, lang: str | None = None, mode: str | None = None) -> dict:
    mode = mode or os.environ.get("SCAN_MODE", "heuristic")
    path = os.environ.get("SCAN_MODEL_PATH", "")
    if mode == "model":
        if path:
            res = _model_scan(text, lang, path)
            if res:
                return res
        else:
            log.warning("SCAN_MODE=model but SCAN_MODEL_PATH is not set; using heuristic")
    return _heuristic(text, lang)
