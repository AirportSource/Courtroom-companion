"""Advisory output-size estimate before the single model call, never action detection.

Every modern chat schema permits an optional action, including ordinary chat. Schema capability
alone must not raise every request's budget. Explicit creation requests get more headroom; only
the model's separately validated action can create a file. Unrecognized phrasing stays at the
normal budget and fails safely if truncated. A future task planner can pass the same workload.
"""

import re
import unicodedata

from ..llm.base import OutputWorkload

_TARGET = re.compile(
    r"\.(?:txt|md|py)\b|\b(?:file|script|document|markdown|checklist|fichier|texte|liste"
    r"|documento|lista|testo|archivo|texto)\b", re.I)
# A request verb at the start of a sentence, optionally after a polite request prefix and an
# indirect pronoun ("Est-ce que tu peux me faire...", "¿Puedes crear...", "Mi puoi scrivere...").
_START = r"(?:^|[\n.!?。！？¿¡])\s*"
_REQUEST = re.compile(
    _START + r"(?:please\s+)?"
    r"(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|i\s+(?:want|need)(?:\s+you)?\s+to\s+)?"
    r"(?:create|write|save|generate|make|export|produce|put|build|draft|prepare)\b"
    r"|" + _START + r"(?:(?:est-ce\s+que\s+)?(?:tu\s+(?:peux|pourrais)|vous\s+(?:pouvez|pourriez))\s+"
    r"|(?:peux-tu|pourrais-tu|pouvez-vous|pourriez-vous)\s+)?(?:me\s+|m['’]|nous\s+|lui\s+)?"
    r"(?:cree|creer|ecris|ecrire|redige|rediger|genere|generer|enregistre|enregistrer|sauvegarde"
    r"|sauvegarder|mets|mettre|fais|faire|prepare|preparer)\b"
    r"|" + _START + r"(?:je\s+voudrais|j['’]aimerais|il\s+me\s+faut)\s+(?:avoir\s+)?(?:un|une)\b"
    r"|" + _START + r"(?:(?:mi\s+)?(?:puoi|potresti)\s+(?:mi\s+)?)?"
    r"(?:crea|creare|creami|scrivi|scrivere|scrivimi|prepara|preparare|preparami|genera|generare"
    r"|salva|salvare|fai|fare|fammi)\b"
    r"|" + _START + r"(?:(?:me\s+)?(?:puedes|podrias)\s+)?"
    r"(?:crea|crear|creame|escribe|escribir|escribeme|prepara|preparar|preparame|genera|generar"
    r"|guarda|guardar|haz|hacer|hazme)\b", re.I,
)
_JAPANESE_TARGET = re.compile(r"ファイル|スクリプト|テキスト|マークダウン|\.(?:txt|md|py)\b", re.I)
_JAPANESE_REQUEST = re.compile(r"作成して|作って|生成して|保存して|書いて|書き出して")


def expected_workload(message: str, *, artifacts_enabled: bool) -> OutputWorkload:
    if not artifacts_enabled:
        return OutputWorkload.DIALOGUE
    # Accent folding only for the budget hint; the actual message/content is never changed.
    text = "".join(c for c in unicodedata.normalize("NFKD", message) if not unicodedata.combining(c))
    demo = re.search(r"(?:^|\s)#artifact-(?:txt|md|py)(?:\s|$)", text, re.I)
    explicit = _TARGET.search(text) and _REQUEST.search(text)
    japanese = _JAPANESE_TARGET.search(message) and _JAPANESE_REQUEST.search(message)
    return OutputWorkload.TEXT_ARTIFACT if demo or explicit or japanese else OutputWorkload.DIALOGUE
