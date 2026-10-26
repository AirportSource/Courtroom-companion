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
# A creation verb anywhere in the message ("find the academies and generate an md file"), for
# requests whose verb is not at the start of a sentence. Only used together with a file target.
_VERB = re.compile(
    r"\b(?:create|write|save|generate|make|export|produce|build|draft|prepare|compile|put|jot"
    r"|cree|creer|ecris|ecrire|redige|rediger|genere|generer|enregistre|enregistrer|sauvegarde|sauvegarder"
    r"|mets|mettre|fais|prepare|preparer|crea|creare|creami|scrivi|scrivere|scrivimi|preparami|genera"
    r"|generare|salva|salvare|fammi|crear|creame|escribe|escribir|escribeme|preparar|preparame|generar"
    r"|guarda|guardar|hazme)\b", re.I)
# Explicit output formats: a strong request signal on their own ("as an md file", "dans un fichier").
_FORMAT = re.compile(
    r"\b(?:md|markdown|txt|text|python)\s+files?\b|\b(?:in|into|as|to)\s+(?:a|an|one)\s+(?:new\s+|separate\s+)?file\b"
    r"|\bfichiers?\s+(?:md|markdown|txt|texte|python)\b|\b(?:(?:dans|en)\s+(?:un\s+)?|sous\s+forme\s+d(?:e\s+|['’]))fichier\b"
    r"|\bfile\s+(?:di\s+testo|markdown|txt)\b|\bin\s+un\s+file\b|\barchivos?\s+(?:md|markdown|txt|de\s+texto)\b"
    r"|\ben\s+un\s+archivo\b", re.I)
# How-to questions, explanations, negations and questions about past work are not requests.
_NOT_A_REQUEST = re.compile(
    r"\bhow\b|\bexplain|\bdon'?t\b|\bdo\s+not\b|\bnever\b|\b(?:did|have|has)\s+you\b|\bwhat\s+is\b"
    r"|\bcomment\b|\bsavoir\b|\bpourquoi\b|\bne\s+\S+\s+pas\b|\bas[- ]tu\b|\bcome\s+si\b|\bperche\b"
    r"|\bc[oó]mo\b|\bpor\s*qu[eé]\b", re.I)
_JAPANESE_TARGET = re.compile(r"ファイル|スクリプト|テキスト|マークダウン|\.(?:txt|md|py)\b", re.I)
_JAPANESE_REQUEST = re.compile(r"作成して|作って|生成して|保存して|書いて|書き出して")


def expected_workload(message: str, *, artifacts_enabled: bool) -> OutputWorkload:
    if not artifacts_enabled:
        return OutputWorkload.DIALOGUE
    # Accent folding only for the budget hint; the actual message/content is never changed.
    text = "".join(c for c in unicodedata.normalize("NFKD", message) if not unicodedata.combining(c))
    demo = re.search(r"(?:^|\s)#artifact-(?:txt|md|py)(?:\s|$)", text, re.I)
    explicit = _TARGET.search(text) and _REQUEST.search(text)
    if not explicit and not _NOT_A_REQUEST.search(text):
        explicit = bool(_FORMAT.search(text) or (_TARGET.search(text) and _VERB.search(text)))
    japanese = _JAPANESE_TARGET.search(message) and _JAPANESE_REQUEST.search(message)
    return OutputWorkload.TEXT_ARTIFACT if demo or explicit or japanese else OutputWorkload.DIALOGUE
