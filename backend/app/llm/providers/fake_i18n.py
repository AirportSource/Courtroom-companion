"""Offline Fake provider texts in the interface languages (D-066).

Placeholders only: each entry replaces the beat texts of the English pattern of the same name,
in order (emotions, reactions and gestures are unchanged). Missing languages or patterns fall
back to English.
"""

TRANSLATIONS: dict[str, dict[str, list[str]]] = {
    "fr": {
        "greeting": ["Oh, salut ! Ça fait plaisir de te voir. Qu'est-ce qui t'amène ?"],
        "realization": ["Hmm...", "Attends, QUOI ?!", "Oh ! D'accord, j'ai compris !"],
        "explain": [
            "Hmm... en Python, un décorateur enveloppe une fonction pour changer ce qu'elle fait.",
            "Attends, c'est un peu comme canaliser un esprit !",
            "Bon... peut-être pas.",
        ],
        "worried": ["Tu es sérieux ?", "Ça a l'air vraiment grave... tu vas bien ?"],
        "joke": ["Hihi ! Je te taquine."],
        "thanks": ["Ooh, merci ! Ça me touche vraiment."],
        "sad": ["Oh... ça me fait de la peine.", "Si tu veux en parler, je suis là."],
        "neutral": ["Je vois. Raconte-moi tout !"],
        "story": [
            "Bon, c'est un peu gênant, mais il faut que je te le dise. La semaine dernière, j'ai essayé de canaliser ma sœur pour lui poser une question sur une affaire. À la place, je suis tombée sur ma grand-tante, qui voulait juste se plaindre de la météo pendant une heure !",
            "Elle m'a même grondée parce que je ne mange pas assez de légumes, et puis elle a disparu sans dire au revoir, après tous ces efforts et trois grands bols de nouilles, tu te rends compte ?",
            "Enfin, c'est ça, la famille.",
        ],
        "evidence": [
            "Alors voici « {name} »... Voyons ça de plus près.",
            "Je ne peux pas vraiment examiner de preuve en mode test hors ligne, mais c'est noté !",
        ],
    },
    "ja": {
        "greeting": ["あっ、こんにちは！会えてうれしいな。どうしたの？"],
        "realization": ["うーん…", "えっ、ええええっ！？", "あっ！そういうことか！"],
        "explain": [
            "うーん…Pythonのデコレーターは、関数を包んで動きを変えるものなんだ。",
            "待って、それって霊媒みたいじゃない！？",
            "…やっぱり違うかも。",
        ],
        "worried": ["本気で言ってるの？", "それは大変…大丈夫？"],
        "joke": ["えへへ！ちょっとからかっただけだよ。"],
        "thanks": ["わあ、ありがとう！すごくうれしい。"],
        "sad": ["そっか…それはつらいね。", "話したくなったら、いつでも聞くよ。"],
        "neutral": ["なるほど。もっと聞かせて！"],
        "story": [
            "ちょっと恥ずかしいんだけど、聞いてくれる？先週、事件のことを聞こうとしてお姉ちゃんを霊媒しようとしたの。そしたら出てきたのは大叔母さんで、一時間ずっと天気の文句を言ってたんだよ！",
            "しかも野菜を食べなさいって怒られて、さよならも言わずに消えちゃったの。あんなにがんばって、ラーメンを三杯も食べたのに、信じられる？",
            "まあ、家族ってそんなものだよね。",
        ],
        "evidence": [
            "これが「{name}」…じっくり見てみるね。",
            "オフラインのテストモードだと証拠をちゃんと調べられないけど、記録しておくね！",
        ],
    },
    "it": {
        "greeting": ["Oh, ciao! Che bello vederti. Cosa ti passa per la testa?"],
        "realization": ["Mmm...", "Aspetta, COSA?!", "Oh! Ok, ora ho capito!"],
        "explain": [
            "Mmm... in Python, un decoratore avvolge una funzione per cambiarne il comportamento.",
            "Aspetta, è un po' come evocare uno spirito!",
            "Ok... forse no.",
        ],
        "worried": ["Dici sul serio?", "Sembra davvero brutto... stai bene?"],
        "joke": ["Ihih! Ti sto solo prendendo in giro."],
        "thanks": ["Oh, grazie! Significa davvero molto per me."],
        "sad": ["Oh... mi dispiace sentirlo.", "Se vuoi parlarne, sono qui."],
        "neutral": ["Capisco. Raccontami di più!"],
        "story": [
            "Ok, è un po' imbarazzante, ma devo dirtelo. La settimana scorsa ho provato a evocare mia sorella per chiederle di un caso. Invece mi è comparsa la prozia, che voleva solo lamentarsi del tempo per un'ora intera!",
            "Mi ha perfino rimproverata perché non mangio abbastanza verdura, e poi è sparita senza salutare, dopo tutta quella fatica e tre ciotole intere di noodles, ci credi?",
            "Beh, la famiglia è così.",
        ],
        "evidence": [
            "Quindi questo è \"{name}\"... Diamo un'occhiata da vicino.",
            "In modalità test offline non posso davvero esaminare le prove, ma l'ho annotato!",
        ],
    },
    "es": {
        "greeting": ["¡Oh, hola! Qué alegría verte. ¿Qué te cuentas?"],
        "realization": ["Mmm...", "Espera, ¡¿QUÉ?!", "¡Oh! ¡Vale, ya lo entiendo!"],
        "explain": [
            "Mmm... en Python, un decorador envuelve una función para cambiar lo que hace.",
            "¡Espera, eso es como canalizar un espíritu!",
            "Vale... quizá no.",
        ],
        "worried": ["¿Lo dices en serio?", "Eso suena muy mal... ¿estás bien?"],
        "joke": ["¡Jiji! Solo te estoy tomando el pelo."],
        "thanks": ["¡Ay, gracias! Significa mucho para mí."],
        "sad": ["Oh... siento oír eso.", "Si quieres hablar de ello, aquí estoy."],
        "neutral": ["Ya veo. ¡Cuéntame más!"],
        "story": [
            "Vale, esto es un poco vergonzoso, pero tengo que contártelo. La semana pasada intenté canalizar a mi hermana para preguntarle por un caso. ¡Y en su lugar apareció mi tía abuela, que solo quería quejarse del tiempo durante una hora!",
            "Hasta me regañó por no comer suficiente verdura, y luego desapareció sin despedirse, después de tanto esfuerzo y tres tazones enteros de fideos, ¿te lo puedes creer?",
            "Bueno, así es la familia.",
        ],
        "evidence": [
            "Así que esto es «{name}»... Déjame echarle un buen vistazo.",
            "En el modo de prueba sin conexión no puedo examinar pruebas de verdad, ¡pero queda anotado!",
        ],
    },
}

EVIDENCE_EN = [
    'So this is "{name}"... Let me take a good look.',
    "I can't really examine evidence in offline test mode, but it's noted!",
]

#: Extra keywords so offline replies react to messages written in these languages.
LOCAL_KEYWORDS: list[tuple[tuple[str, ...], str]] = [
    ((" bonjour", " salut", "こんにちは", "おはよう", " ciao", "buongiorno", " hola", "buenos días"), "greeting"),
    (("merci", "ありがとう", "grazie", "gracias"), "thanks"),
    (("triste", "悲しい", "さみしい", "déprimé"), "sad"),
    (("blague", "drôle", "冗談", "scherzo", "chiste", "broma"), "joke"),
    (("explique", "comment ça marche", "説明", "spiega", "come funziona", "explica", "cómo funciona"), "explain"),
    (("histoire", "raconte", "話して", "storia", "racconta", "historia", "cuéntame"), "story"),
    (("peur", "怖い", "paura", "miedo"), "worried"),
]
