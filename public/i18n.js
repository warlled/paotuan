/* Shared interface localisation for the main site, rooms and profile pages. */
(() => {
  const STORAGE_KEY = "pt-lang";
  const SUPPORTED = ["zh-Hans", "zh-Hant", "en", "ja", "ko", "de", "fr", "ru"];
  const LANGUAGE_NAMES = {
    "zh-Hans": "简体中文",
    "zh-Hant": "繁體中文",
    en: "English",
    ja: "日本語",
    ko: "한국어",
    de: "Deutsch",
    fr: "Français",
    ru: "Русский",
  };

  // Order: English, Japanese, French, Russian.
  const D = {
    "好评": ["Likes", "高評価", "J'aime", "Нравится"],
    "差评": ["Dislikes", "低評価", "Je n'aime pas", "Не нравится"],
    "留言板": ["Feedback", "掲示板", "Messages", "Отзывы"],
    "我的": ["Profile", "マイ", "Profil", "Профиль"],
    "社区": ["Community", "コミュニティ", "Communauté", "Сообщество"],
    "联机": ["Multiplayer", "マルチ", "Multijoueur", "Совместная игра"],
    "当前在线人数": ["People online", "現在のオンライン人数", "Personnes en ligne", "Сейчас онлайн"],
    "玩家状态栏": ["Player panel", "プレイヤーパネル", "Panneau joueur", "Панель игрока"],
    "缩小状态栏": ["Compact player panel", "プレイヤーパネルを縮小", "Réduire le panneau joueur", "Свернуть панель игрока"],
    "切换半透明": ["Change panel transparency", "パネルの透明度を変更", "Changer la transparence", "Изменить прозрачность"],
    "隐藏状态栏": ["Hide player panel", "プレイヤーパネルを隠す", "Masquer le panneau joueur", "Скрыть панель игрока"],
    "显示玩家状态栏": ["Show player panel", "プレイヤーパネルを表示", "Afficher le panneau joueur", "Показать панель игрока"],
    "状态栏": ["Player panel", "プレイヤーパネル", "Panneau joueur", "Панель игрока"],
    "状态": ["Status", "状態", "Statut", "Статус"],
    "关闭状态面板": ["Close status panel", "ステータスを閉じる", "Fermer le panneau", "Закрыть панель"],
    "四、玩法与难度": ["4. Mode and difficulty", "4. モードと難易度", "4. Mode et difficulté", "4. Режим и сложность"],
    "四、玩法": ["4. Mode", "4. モード", "4. Mode", "4. Режим"],
    "网站默认选项（按剧本自动推荐，可随时切换）": ["Website default (recommended by story, switch anytime)", "サイト標準（シナリオに応じて自動選択・変更可）", "Par défaut du site (recommandé selon le scénario, modifiable)", "По умолчанию (по сценарию, можно сменить)"],
    "跑团规则（有判定与代价）": ["Tabletop rules (checks and consequences)", "TRPGルール（判定と代償）", "Règles de table (jets et conséquences)", "Настольные правила (проверки и последствия)"],
    "自由探索（ARPG：不掷骰，但有世界、任务、NPC 与成长）": ["Free exploration (ARPG: no dice, with world, quests, NPCs and growth)", "自由探索（ARPG：ダイスなし、世界・依頼・NPC・成長あり）", "Exploration libre (ARPG : sans dés, avec monde, quêtes, PNJ et progression)", "Свободное исследование (ARPG: без бросков, с миром, заданиями, NPC и развитием)"],
    "默认会按剧本类型选择跑团或自由探索。": ["The site chooses tabletop or free exploration based on the story.", "シナリオに応じてTRPGまたは自由探索を選びます。", "Le site choisit selon le scénario.", "Сайт выберет режим по типу сценария."],
    "跑团规则难度": ["Tabletop difficulty", "TRPG難易度", "Difficulté du jeu de table", "Сложность настольного режима"],
    "高级 GM 控制台": ["Advanced GM console", "上級GMコンソール", "Console MJ avancée", "Расширенная панель ведущего"],
    "查看网站 GM 核心规则（只读）": ["View website GM core rules (read-only)", "サイトのGM基本ルール（閲覧のみ）", "Règles GM du site (lecture seule)", "Базовые правила ведущего (только чтение)"],
    "快速方案": ["Quick presets", "プリセット", "Préréglages", "Пресеты"],
    "均衡": ["Balanced", "バランス", "Équilibré", "Баланс"],
    "沉浸": ["Immersive", "没入型", "Immersif", "Погружение"],
    "硬核": ["Hardcore", "ハードコア", "Hardcore", "Хардкор"],
    "自由探索": ["Free exploration", "自由探索", "Exploration libre", "Свободное исследование"],
    "跑团规则": ["Tabletop rules", "TRPGルール", "Règles de table", "Настольные правила"],
    "轻松": ["Light", "ライト", "Léger", "Лёгкий"],
    "启用高级 GM 配置": ["Enable advanced GM settings", "上級GM設定を有効化", "Activer les réglages MJ avancés", "Включить настройки ведущего"],
    "暴力与动作强度": ["Violence and action intensity", "暴力・アクション強度", "Intensité violence/action", "Интенсивность насилия и действия"],
    "恐怖与心理压迫": ["Horror and psychological pressure", "ホラー・心理的圧迫", "Horreur et pression psychologique", "Ужас и психологическое давление"],
    "情感与亲密张力": ["Emotional and intimacy tension", "感情・親密さの緊張", "Tension émotionnelle et intime", "Эмоциональное и близкое напряжение"],
    "轻松幽默": ["Light humour", "軽いユーモア", "Humour léger", "Лёгкий юмор"],
    "危险与失败严重度": ["Danger and failure severity", "危険・失敗の重さ", "Gravité du danger et de l'échec", "Опасность и тяжесть провала"],
    "世界规则一致性": ["World consistency", "世界ルールの一貫性", "Cohérence du monde", "Целостность мира"],
    "玩家行动自由": ["Player freedom", "プレイヤーの自由度", "Liberté du joueur", "Свобода игрока"],
    "NPC 自主行动": ["NPC autonomy", "NPCの自律行動", "Autonomie des PNJ", "Самостоятельность NPC"],
    "个人提示词注入": ["Personal prompt injection", "個人プロンプト注入", "Injection de prompt personnelle", "Личная инъекция промпта"],
    "保存并应用": ["Save and apply", "保存して適用", "Enregistrer et appliquer", "Сохранить и применить"],
    "恢复默认": ["Restore defaults", "初期値に戻す", "Rétablir les valeurs", "Сбросить настройки"],
    "关闭": ["Close", "閉じる", "Fermer", "Закрыть"],
    "反馈与留言": ["Feedback & messages", "フィードバックと掲示板", "Avis et messages", "Отзывы и сообщения"],
    "留言会显示你的昵称和头像，可在「我的」里设置。": [
      "Your nickname and avatar will appear with your message. You can change them in Profile.",
      "メッセージにはニックネームとアイコンが表示されます。「マイ」で変更できます。",
      "Votre pseudo et votre avatar accompagneront votre message. Modifiez-les dans Profil.",
      "Сообщение будет показано с вашим именем и аватаром. Их можно изменить в профиле.",
    ],
    "说说这一局的体验、想改进的地方，或者留一句给后来的人。": [
      "Share your experience, suggest improvements, or leave a note for other players.",
      "体験、改善してほしい点、他のプレイヤーへのメッセージを書いてください。",
      "Partagez votre expérience, vos suggestions ou un message pour les autres joueurs.",
      "Поделитесь впечатлениями, предложениями или оставьте сообщение другим игрокам.",
    ],
    "发布": ["Post", "投稿", "Publier", "Отправить"],
    "‹ 上一页": ["‹ Previous", "‹ 前へ", "‹ Précédent", "‹ Назад"],
    "下一页 ›": ["Next ›", "次へ ›", "Suivant ›", "Вперёд ›"],
    "我的资料": ["My profile", "マイプロフィール", "Mon profil", "Мой профиль"],
    "头像": ["Avatar", "アイコン", "Avatar", "Аватар"],
    "昵称": ["Nickname", "ニックネーム", "Pseudo", "Никнейм"],
    "一句话个人简介": ["Short bio", "ひとこと自己紹介", "Bio courte", "Краткая биография"],
    "上传头像": ["Upload avatar", "アイコンをアップロード", "Téléverser un avatar", "Загрузить аватар"],
    "主题色": ["Accent color", "テーマカラー", "Couleur d'accent", "Акцентный цвет"],
    "网站主题": ["Site theme", "サイトテーマ", "Thème du site", "Тема сайта"],
    "淡粉": ["Soft pink", "淡いピンク", "Rose pâle", "Нежно-розовая"],
    "黄白": ["Warm ivory", "アイボリー", "Ivoire chaud", "Тёплый кремовый"],
    "界面字号": ["Interface size", "文字サイズ", "Taille de l'interface", "Размер интерфейса"],
    "小": ["Small", "小", "Petit", "Малый"],
    "中": ["Medium", "中", "Moyen", "Средний"],
    "大": ["Large", "大", "Grand", "Большой"],
    "语言": ["Language", "言語", "Langue", "Язык"],
    "网站语言": ["Website language", "サイト言語", "Langue du site", "Язык сайта"],
    "AI 模型（可选，用自己的额度）": [
      "AI model (optional, uses your own quota)",
      "AIモデル（任意・自分の利用枠）",
      "Modèle IA (facultatif, avec votre quota)",
      "Модель ИИ (необязательно, своя квота)",
    ],
    "模型目录（选择后自动填接口和模型名）": [
      "Model catalogue (fills endpoint and model)",
      "モデル一覧（選択するとAPIとモデル名を入力）",
      "Catalogue de modèles (remplit l'API et le modèle)",
      "Каталог моделей (заполнит API и модель)",
    ],
    "接口地址（OpenAI 兼容 Base URL）": [
      "Endpoint (OpenAI-compatible Base URL)",
      "APIアドレス（OpenAI互換 Base URL）",
      "Adresse API (Base URL compatible OpenAI)",
      "Адрес API (Base URL, совместимый с OpenAI)",
    ],
    "模型名": ["Model name", "モデル名", "Nom du modèle", "Название модели"],
    "API Key（留空则不修改）": [
      "API key (leave blank to keep current)",
      "APIキー（空欄なら変更なし）",
      "Clé API (laisser vide pour conserver)",
      "API-ключ (оставьте пустым, чтобы не менять)",
    ],
    "使用网站默认的 AI 模型（deepseek-v4.1-flash）": [
      "Use the site AI model (deepseek-v4.1-flash)",
      "サイト標準AIモデルを使う（deepseek-v4.1-flash）",
      "Utiliser le modèle IA du site (deepseek-v4.1-flash)",
      "Использовать модель сайта (deepseek-v4.1-flash)",
    ],
    "保存": ["Save", "保存", "Enregistrer", "Сохранить"],
    "测试连接": ["Test connection", "接続テスト", "Tester la connexion", "Проверить подключение"],
    "清除": ["Clear", "クリア", "Effacer", "Очистить"],
    "保存资料": ["Save profile", "プロフィールを保存", "Enregistrer le profil", "Сохранить профиль"],
    "进入我的私人空间": [
      "Open my private space",
      "プライベート空間を開く",
      "Ouvrir mon espace privé",
      "Открыть личное пространство",
    ],
    "创作社区": ["Creative community", "創作コミュニティ", "Communauté créative", "Творческое сообщество"],
    "全部": ["All", "すべて", "Tout", "Все"],
    "历史": ["History", "歴史", "Histoire", "История"],
    "奇幻": ["Fantasy", "ファンタジー", "Fantasy", "Фэнтези"],
    "科幻": ["Sci-fi", "SF", "Science-fiction", "Фантастика"],
    "现实": ["Realistic", "現実", "Réaliste", "Реализм"],
    "言情": ["Romance", "恋愛", "Romance", "Романтика"],
    "脑洞": ["Wild ideas", "奇想", "Idées folles", "Безумные идеи"],
    "玄幻": ["Mystic fantasy", "玄幻", "Fantastique oriental", "Мистическое фэнтези"],
    "仙侠": ["Xianxia", "仙侠", "Xianxia", "Сянься"],
    "怪谈": ["Weird tales", "怪談", "Récits étranges", "Странные истории"],
    "悬疑": ["Mystery", "ミステリー", "Mystère", "Детектив"],
    "搜索剧本标题、类型或玩家昵称…": [
      "Search stories, genres, or players…",
      "シナリオ名・ジャンル・プレイヤーを検索…",
      "Rechercher un scénario, un genre ou un joueur…",
      "Поиск сценария, жанра или игрока…",
    ],
    "搜索": ["Search", "検索", "Rechercher", "Искать"],
    "作品标题": ["Post title", "作品タイトル", "Titre", "Название публикации"],
    "写下你的设定、剧本片段、角色故事，或分享一张跑团截图……": [
      "Write your setting, story excerpt, character story, or share a screenshot…",
      "設定・シナリオ・キャラクターの物語、またはスクリーンショットを共有…",
      "Écrivez votre univers, un extrait, une histoire de personnage ou partagez une capture…",
      "Опишите мир, фрагмент сценария, историю героя или поделитесь скриншотом…",
    ],
    "标签，逗号分隔（如：民国, 悬疑）": [
      "Tags, comma-separated (e.g. Republic era, mystery)",
      "タグをカンマ区切り（例：民国, ミステリー）",
      "Tags séparés par des virgules (ex. époque républicaine, mystère)",
      "Теги через запятую (например, республика, детектив)",
    ],
    "添加图片/视频": ["Add image/video", "画像/動画を追加", "Ajouter image/vidéo", "Добавить фото/видео"],
    "玩家自由创作游玩": ["Player-driven creation and play", "プレイヤー創作プレイ", "Création et jeu libres", "Свободное творчество и игра"],
    "社区网站平台": ["Community platform", "コミュニティサイト", "Plateforme communautaire", "Сетевая платформа"],
    "选一个剧本和角色开始故事；也可以自己写剧本、发布作品、装饰自己的空间。": [
      "Choose a story and character to begin. You can also write stories, publish works, and personalise your space.",
      "シナリオとキャラクターを選んで開始。自作シナリオ、作品公開、空間の装飾もできます。",
      "Choisissez un scénario et un personnage. Vous pouvez aussi créer, publier et personnaliser votre espace.",
      "Выберите сценарий и героя. Здесь можно создавать и публиковать истории и оформлять личное пространство.",
    ],
    "＋ 写一个新剧本": ["＋ New story", "＋ 新しいシナリオ", "＋ Nouveau scénario", "＋ Новый сценарий"],
    "去创作社区": ["Open community", "創作コミュニティへ", "Ouvrir la communauté", "В сообщество"],
    "我的空间": ["My space", "マイ空間", "Mon espace", "Моё пространство"],
    "一、选剧本": ["1. Choose a story", "1. シナリオ選択", "1. Choisir un scénario", "1. Выберите сценарий"],
    "加入剧本": ["Join story", "シナリオに参加", "Rejoindre le scénario", "Присоединиться к сценарию"],
    "当前剧本": ["Selected story", "選択中のシナリオ", "Scénario sélectionné", "Выбранный сценарий"],
    "← 返回剧本列表": ["← Back to stories", "← シナリオ一覧へ", "← Retour aux scénarios", "← К списку сценариев"],
    "请先选择一个剧本": ["Choose a story first", "先にシナリオを選択してください", "Choisissez d’abord un scénario", "Сначала выберите сценарий"],
    "选中后进入角色创建": ["Select a story to create your character", "選択後にキャラクター作成へ進みます", "Sélectionnez un scénario pour créer un personnage", "После выбора перейдите к созданию героя"],
    "原创": ["Original", "オリジナル", "Original", "Оригинальные"],
    "同人": ["Fan work", "二次創作", "Fan work", "Фан-работа"],
    "墨绿": ["Ink green", "インクグリーン", "Vert encre", "Тёмно-зелёная"],
    "暖褐": ["Warm brown", "ウォームブラウン", "Brun chaud", "Тёпло-коричневая"],
    "夜蓝": ["Night blue", "ナイトブルー", "Bleu nuit", "Ночная синяя"],
    "紫夜": ["Violet night", "バイオレットナイト", "Nuit violette", "Фиолетовая ночь"],
    "纯黑": ["Pure black", "ピュアブラック", "Noir pur", "Чистый чёрный"],
    "排序": ["Sort", "並び順", "Trier", "Сортировка"],
    "最新": ["Newest", "最新", "Récents", "Новые"],
    "最热": ["Hottest", "人気順", "Populaires", "Популярные"],
    "评论排序": ["Comment order", "コメント順", "Ordre des commentaires", "Порядок комментариев"],
    "回复": ["Reply", "返信", "Répondre", "Ответить"],
    "点赞": ["Like", "いいね", "J'aime", "Нравится"],
    "收藏": ["Favorite", "お気に入り", "Favoris", "В избранное"],
    "转发": ["Share", "共有", "Partager", "Поделиться"],
    "评论": ["Comment", "コメント", "Commenter", "Комментарий"],
    "编辑": ["Edit", "編集", "Modifier", "Изменить"],
    "发送": ["Send", "送信", "Envoyer", "Отправить"],
    "详情": ["Details", "詳細", "Détails", "Подробнее"],
    "可编辑": ["Editable", "編集可能", "Modifiable", "Можно редактировать"],
    "作者": ["Author", "作者", "Auteur", "Автор"],
    "匿名作者": ["Anonymous author", "匿名作者", "Auteur anonyme", "Анонимный автор"],
    "玩家互动": ["Player interaction", "プレイヤー交流", "Interactions des joueurs", "Взаимодействие игроков"],
    "封面待补充": ["Cover coming soon", "カバー未設定", "Couverture à venir", "Обложка не добавлена"],
    "还没有评论，来聊一聊你的想法。": [
      "No comments yet. Share what you think.",
      "まだコメントはありません。感想を書いてみましょう。",
      "Aucun commentaire. Partagez votre avis.",
      "Комментариев пока нет. Поделитесь впечатлением.",
    ],
    "剧本链接已复制": ["Story link copied", "シナリオリンクをコピーしました", "Lien du scénario copié", "Ссылка на сценарий скопирована"],
    "对剧本发表评论…": ["Write a comment…", "コメントを書く…", "Écrire un commentaire…", "Написать комментарий…"],
    "作者署名（封面公开）": ["Author credit (shown on cover)", "作者名（カバーに公開）", "Crédit d'auteur (visible sur la couverture)", "Автор (публично на обложке)"],
    "填写你自己的公开笔名": ["Enter your public pen name", "公開ペンネームを入力", "Saisissez votre pseudonyme public", "Укажите публичный псевдоним"],
    "一键发布到社区": ["Publish to community", "コミュニティへ公開", "Publier dans la communauté", "Опубликовать в сообществе"],
    "发布到社区": ["Publish to community", "コミュニティへ公開", "Publier dans la communauté", "Опубликовать в сообществе"],
    "分享剧本页面": ["Share story page", "シナリオページを共有", "Partager la page du scénario", "Поделиться страницей сценария"],
    "打开剧本页面": ["Open story page", "シナリオページを開く", "Ouvrir la page du scénario", "Открыть страницу сценария"],
    "打开剧本": ["Open story", "シナリオを開く", "Ouvrir le scénario", "Открыть сценарий"],
    "剧本页面链接已复制": ["Story page link copied", "シナリオページのリンクをコピーしました", "Lien de la page du scénario copié", "Ссылка на страницу сценария скопирована"],
    "已打开系统分享": ["Share menu opened", "共有メニューを開きました", "Menu de partage ouvert", "Меню публикации открыто"],
    "已取消分享": ["Share cancelled", "共有をキャンセルしました", "Partage annulé", "Публикация отменена"],
    "正在发布到社区…": ["Publishing to community…", "コミュニティへ公開中…", "Publication dans la communauté…", "Публикация в сообществе…"],
    "已发布到创作社区。": ["Published to the creative community.", "創作コミュニティへ公開しました。", "Publié dans la communauté créative.", "Опубликовано в творческом сообществе."],
    "社区推广信息已更新。": ["Community promotion updated.", "コミュニティ掲載情報を更新しました。", "Présentation communautaire mise à jour.", "Информация в сообществе обновлена."],
    "自己写一个剧本": ["Write a new story", "シナリオを作成", "Créer un scénario", "Создать сценарий"],
    "编辑选中的自定义剧本": ["Edit selected story", "選択中の自作シナリオを編集", "Modifier le scénario sélectionné", "Изменить выбранный сценарий"],
    "删除选中的自定义剧本": ["Delete selected story", "選択中の自作シナリオを削除", "Supprimer le scénario sélectionné", "Удалить выбранный сценарий"],
    "分享到社区": ["Share to community", "コミュニティへ共有", "Partager dans la communauté", "Поделиться в сообществе"],
    "二、写你的角色": ["2. Create your character", "2. キャラクター作成", "2. Créez votre personnage", "2. Создайте героя"],
    "姓名 *": ["Name *", "名前 *", "Nom *", "Имя *"],
    "称呼 / 性别": ["Title / gender", "呼称 / 性別", "Titre / genre", "Обращение / пол"],
    "年龄": ["Age", "年齢", "Âge", "Возраст"],
    "身份职业": ["Role / occupation", "身分・職業", "Rôle / métier", "Роль / профессия"],
    "外貌": ["Appearance", "外見", "Apparence", "Внешность"],
    "性格": ["Personality", "性格", "Personnalité", "Характер"],
    "背景": ["Background", "経歴", "Historique", "Биография"],
    "能力": ["Abilities", "能力", "Capacités", "Способности"],
    "目标 / 动机": ["Goal / motivation", "目的 / 動機", "Objectif / motivation", "Цель / мотив"],
    "保存这个角色": ["Save character", "キャラクターを保存", "Enregistrer le personnage", "Сохранить героя"],
    "读取": ["Load", "読込", "Charger", "Загрузить"],
    "删除": ["Delete", "削除", "Supprimer", "Удалить"],
    "三、分配属性（共 30 点，每项 1-10）": [
      "3. Assign attributes (30 points, 1–10 each)",
      "3. 能力値を配分（合計30点、各1〜10）",
      "3. Répartissez les attributs (30 points, 1 à 10)",
      "3. Распределите характеристики (30 очков, по 1–10)",
    ],
    "随机分配": ["Randomise", "ランダム配分", "Répartition aléatoire", "Случайно"],
    "重置为 5": ["Reset to 5", "5に戻す", "Réinitialiser à 5", "Сбросить на 5"],
    "四、难度": ["4. Difficulty", "4. 難易度", "4. Difficulté", "4. Сложность"],
    "玩法": ["Mode", "モード", "Mode", "Режим"],
    "跑团规则（有判定与代价）": [
      "Tabletop rules (checks and consequences)",
      "TRPGルール（判定と代償）",
      "Règles de table (jets et conséquences)",
      "Настольные правила (проверки и последствия)",
    ],
    "自由探索（ARPG：不掷骰，但有世界、任务、NPC 与成长）": [
      "Free exploration (ARPG: no dice, but world, quests, NPCs and growth)",
      "自由探索（ARPG：ダイスなし、世界・依頼・NPC・成長あり）",
      "Exploration libre (ARPG : sans dés, avec monde, quêtes, PNJ et progression)",
      "Свободное исследование (ARPG: без бросков, с миром, заданиями, NPC и развитием)",
    ],
    "开始游戏": ["Start game", "ゲーム開始", "Commencer", "Начать игру"],
    "继续上次的游戏": ["Resume last game", "前回の続き", "Reprendre la partie", "Продолжить игру"],
    "属性": ["Attributes", "能力値", "Attributs", "Характеристики"],
    "技能值": ["Skills", "技能", "Compétences", "Навыки"],
    "探索": ["Exploration", "探索", "Exploration", "Исследование"],
    "当前位置": ["Location", "現在地", "Position", "Местоположение"],
    "等级": ["Level", "レベル", "Niveau", "Уровень"],
    "经验": ["Experience", "経験値", "Expérience", "Опыт"],
    "主动掷骰": ["Manual check", "任意判定", "Jet manuel", "Ручной бросок"],
    "简单": ["Easy", "簡単", "Facile", "Легко"],
    "普通": ["Normal", "普通", "Normal", "Обычно"],
    "困难": ["Hard", "困難", "Difficile", "Сложно"],
    "极难": ["Very hard", "極難", "Très difficile", "Очень сложно"],
    "掷": ["Roll", "振る", "Lancer", "Бросок"],
    "背包": ["Inventory", "持ち物", "Inventaire", "Инвентарь"],
    "线索": ["Clues", "手がかり", "Indices", "Улики"],
    "重要经历": ["Important history", "重要な履歴", "Historique important", "Важные события"],
    "人物关系": ["Relationships", "人物関係", "Relations", "Отношения"],
    "当前目标": ["Current objectives", "現在の目的", "Objectifs actuels", "Текущие цели"],
    "（重要经历会随着你的行动在这里形成）": [
      "(Important moments will take shape here as you act.)",
      "（行動に応じて重要な履歴がここに記録されます）",
      "(Les moments importants apparaîtront ici au fil de vos actions.)",
      "(Важные события будут появляться здесь по мере ваших действий.)",
    ],
    "设定（下一回合生效）": ["Settings (next turn)", "設定（次ターンから）", "Réglages (prochain tour)", "Настройки (со следующего хода)"],
    "叙事篇幅": ["Narrative length", "物語の長さ", "Longueur du récit", "Длина повествования"],
    "思考强度": ["Reasoning effort", "思考強度", "Intensité de réflexion", "Глубина рассуждений"],
    "低（最快）": ["Low (fastest)", "低（最速）", "Faible (rapide)", "Низкая (быстро)"],
    "高（最细，也最慢）": ["High (detailed, slower)", "高（詳細・低速）", "Élevée (détaillée, plus lente)", "Высокая (подробно, медленнее)"],
    "大失败": ["Critical failure", "大失敗", "Échec critique", "Критический провал"],
    "开启（掷出 1 必失败）": ["On (a natural 1 fails)", "オン（1は必ず失敗）", "Activé (1 naturel échoue)", "Вкл. (натуральная 1 — провал)"],
    "关闭（最低也只是代价大）": ["Off (lowest roll still has a cost)", "オフ（最低でも代償のみ）", "Désactivé (coût important seulement)", "Выкл. (минимальный бросок даёт цену)"],
    "补充设定（风格、口径、禁忌，会进提示词）": [
      "Extra instructions (style, tone, taboos; sent to the GM)",
      "追加設定（文体・表現・禁止事項。プロンプトに反映）",
      "Consignes supplémentaires (style, ton, interdits ; envoyées au MJ)",
      "Дополнительные указания (стиль, тон, запреты; передаются ведущему)",
    ],
    "参考资料链接（每行一个）": ["Reference links (one per line)", "参考リンク（1行1件）", "Liens de référence (un par ligne)", "Ссылки (по одной в строке)"],
    "抓取链接内容": ["Fetch link content", "リンク内容を取得", "Récupérer le contenu", "Загрузить содержимое"],
    "保存设定": ["Save settings", "設定を保存", "Enregistrer les réglages", "Сохранить настройки"],
    "自动存档": ["Autosave", "自動保存", "Sauvegarde auto", "Автосохранение"],
    "开场": ["Opening", "導入", "Ouverture", "Вступление"],
    "导出": ["Export", "書き出し", "Exporter", "Экспорт"],
    "存档": ["Save", "セーブ", "Sauvegarder", "Сохранить"],
    "读档": ["Load", "ロード", "Charger", "Загрузить"],
    "重新开始": ["Restart", "最初から", "Recommencer", "Заново"],
    "退出": ["Exit", "終了", "Quitter", "Выйти"],
    "↓ 有新内容，回到最新": ["↓ New content — jump to latest", "↓ 新着 — 最新へ", "↓ Nouveau — aller en bas", "↓ Новое — к последнему"],
    "观察四周": ["Look around", "周囲を見る", "Observer", "Осмотреться"],
    "找人搭话": ["Talk to someone", "誰かに話しかける", "Parler à quelqu'un", "Заговорить с кем-то"],
    "梳理线索": ["Review clues", "手がかりを整理", "Analyser les indices", "Сопоставить улики"],
    "休息一会儿": ["Rest a while", "少し休む", "Se reposer", "Отдохнуть"],
    "你要做什么？（Enter 发送，Shift+Enter 换行）": [
      "What do you do? (Enter to send, Shift+Enter for a new line)",
      "何をしますか？（Enterで送信、Shift+Enterで改行）",
      "Que faites-vous ? (Entrée pour envoyer, Maj+Entrée pour une ligne)",
      "Что вы делаете? (Enter — отправить, Shift+Enter — новая строка)",
    ],
    "行动": ["Act", "行動", "Agir", "Действовать"],
    "开始行动": ["Begin", "開始", "Commencer", "Начать"],
    "正在开幕…": ["Opening…", "導入中…", "Ouverture…", "Начинаем…"],
    "基本力量": ["Strength", "筋力", "Force", "Сила"],
    "敏捷": ["Dexterity", "敏捷", "Dextérité", "Ловкость"],
    "体质": ["Constitution", "耐久", "Constitution", "Телосложение"],
    "智力": ["Intelligence", "知力", "Intelligence", "Интеллект"],
    "感知": ["Perception", "知覚", "Perception", "Восприятие"],
    "魅力": ["Charisma", "魅力", "Charisme", "Обаяние"],
    "力量": ["Strength", "筋力", "Force", "Сила"],
    "侦查": ["Investigate", "捜査", "Enquêter", "Расследование"],
    "聆听": ["Listen", "聞き耳", "Écouter", "Слух"],
    "话术": ["Persuasion", "話術", "Persuasion", "Убеждение"],
    "威吓": ["Intimidate", "威圧", "Intimidation", "Запугивание"],
    "格斗": ["Fighting", "格闘", "Combat", "Драка"],
    "潜行": ["Stealth", "隠密", "Discrétion", "Скрытность"],
    "身手": ["Acrobatics", "身のこなし", "Agilité", "Акробатика"],
    "学识": ["Lore", "学識", "Savoir", "Знания"],
    "医术": ["Medicine", "医学", "Médecine", "Медицина"],
    "意志": ["Willpower", "意志", "Volonté", "Воля"],
    "未记录": ["Not recorded", "未記録", "Non renseigné", "Не указано"],
    "单人": ["Single-player", "ソロ", "Solo", "Одиночная"],
    "多人": ["Multiplayer", "マルチ", "Multijoueur", "Совместная"],
    "页面": ["Page", "ページ", "Page", "Страница"],
    "创作系统": ["Creation system", "創作システム", "Système de création", "Система творчества"],
    "剧本设定与推演规则": ["Story settings and simulation rules", "シナリオ設定と進行ルール", "Réglages du scénario et règles", "Настройки сценария и правила"],
    "从骨架、人物与属性，到事件链、词条和随机机制，每个层级独立维护。": [
      "Maintain the framework, characters and attributes, event chains, lore and random mechanics as separate levels.",
      "世界観・人物・能力値・イベント・用語・ランダム機構を階層ごとに管理します。",
      "Gérez séparément le cadre, les personnages, les attributs, les événements, le lore et les mécanismes aléatoires.",
      "Отдельно управляйте миром, персонажами, характеристиками, событиями, лором и случайными механизмами.",
    ],
    "完成度": ["Completion", "完成度", "Progression", "Готовность"],
    "展开全部": ["Expand all", "すべて展開", "Tout développer", "Развернуть всё"],
    "收起全部": ["Collapse all", "すべて折りたたむ", "Tout réduire", "Свернуть всё"],
    "退出编辑": ["Exit editor", "編集を終了", "Quitter l'éditeur", "Выйти из редактора"],
    "编辑层级": ["Editor sections", "編集階層", "Sections", "Разделы"],
    "基本信息": ["Basic information", "基本情報", "Informations de base", "Основное"],
    "世界与开局": ["World and opening", "世界と開始", "Monde et ouverture", "Мир и начало"],
    "规则配置": ["Rules", "ルール設定", "Règles", "Правила"],
    "实体与属性": ["Entities and attributes", "実体と能力値", "Entités et attributs", "Сущности и характеристики"],
    "人物与关系": ["Characters and relationships", "人物と関係", "Personnages et relations", "Персонажи и отношения"],
    "时间与事件": ["Time and events", "時間とイベント", "Temps et événements", "Время и события"],
    "剧情与结局": ["Plot and endings", "物語と結末", "Intrigue et fins", "Сюжет и финалы"],
    "词条与预设行动": ["Lore and preset actions", "用語と定型行動", "Lore et actions prédéfinies", "Лор и готовые действия"],
    "随机机制": ["Random mechanics", "ランダム機構", "Mécanismes aléatoires", "Случайные механизмы"],
    "资料与导入": ["References and import", "資料と読み込み", "Références et import", "Материалы и импорт"],
    "保存剧本": ["Save story", "シナリオを保存", "Enregistrer le scénario", "Сохранить сценарий"],
    "收起": ["Close", "閉じる", "Réduire", "Закрыть"],
    "添加": ["Add", "追加", "Ajouter", "Добавить"],
    "我的私人空间": ["My private space", "マイプライベート空間", "Mon espace privé", "Моё личное пространство"],
    "私人笔记": ["Private notes", "プライベートメモ", "Notes privées", "Личные заметки"],
    "保存笔记": ["Save notes", "メモを保存", "Enregistrer les notes", "Сохранить заметки"],
    "我的作品": ["My posts", "自分の作品", "Mes publications", "Мои публикации"],
    "我的剧本": ["My stories", "自分のシナリオ", "Mes scénarios", "Мои сценарии"],
    "还没有发布过作品": ["No posts yet", "まだ作品がありません", "Aucune publication", "Публикаций пока нет"],
    "还没有创作剧本": ["No stories yet", "まだシナリオがありません", "Aucun scénario", "Сценариев пока нет"],
    "多人联机 · 创作游玩": ["Multiplayer · Create and play", "マルチプレイ · 創作とプレイ", "Multijoueur · Créer et jouer", "Совместная игра · Творчество"],
    "← 回到单机": ["← Back to solo", "← ソロへ戻る", "← Retour au solo", "← К одиночной игре"],
    "← 回到游戏": ["← Back to game", "← ゲームへ戻る", "← Retour au jeu", "← К игре"],
    "创建房间": ["Create room", "ルーム作成", "Créer une salle", "Создать комнату"],
    "剧本": ["Story", "シナリオ", "Scénario", "Сценарий"],
    "难度": ["Difficulty", "難易度", "Difficulté", "Сложность"],
    "开局设定（可选）": ["Opening setup (optional)", "開始設定（任意）", "Mise en place (facultatif)", "Начальные условия (необязательно)"],
    "你的角色": ["Your character", "あなたのキャラクター", "Votre personnage", "Ваш персонаж"],
    "角色名": ["Character name", "キャラクター名", "Nom du personnage", "Имя героя"],
    "身份 / 职业": ["Role / occupation", "身分 / 職業", "Rôle / métier", "Роль / профессия"],
    "一句话背景": ["Short background", "ひとこと経歴", "Historique court", "Краткая предыстория"],
    "创建房间": ["Create room", "ルーム作成", "Créer une salle", "Создать комнату"],
    "加入房间": ["Join room", "ルーム参加", "Rejoindre une salle", "Войти в комнату"],
    "房间码": ["Room code", "ルームコード", "Code de salle", "Код комнаты"],
    "玩家席位": ["Players", "プレイヤー", "Joueurs", "Игроки"],
    "开始游戏": ["Start game", "ゲーム開始", "Commencer", "Начать игру"],
    "推进剧情": ["Advance story", "物語を進める", "Avancer l'histoire", "Продвинуть сюжет"],
    "世界状态": ["World state", "世界の状態", "État du monde", "Состояние мира"],
    "时间": ["Time", "時間", "Temps", "Время"],
    "位置": ["Location", "場所", "Lieu", "Место"],
    "事件": ["Events", "イベント", "Événements", "События"],
    "情节": ["Plot", "筋", "Intrigue", "Сюжет"],
    "图鉴": ["Codex", "図鑑", "Codex", "Кодекс"],
    "关系": ["Relations", "関係", "Relations", "Отношения"],
    "下一步": ["Next steps", "次の展開", "Prochaines étapes", "Следующие шаги"],
    "任务": ["Quests", "依頼", "Quêtes", "Задания"],
    "已认识": ["Known people", "知り合い", "Personnes connues", "Знакомые"],
    "即将发生": ["Upcoming", "近日予定", "À venir", "Скоро"],
    "剧情记录": ["Story log", "物語ログ", "Journal", "Журнал истории"],
    "发送行动": ["Submit action", "行動を送信", "Envoyer l'action", "Отправить действие"],
    "复制邀请": ["Copy invite", "招待をコピー", "Copier l'invitation", "Копировать приглашение"],
    "导出日志": ["Export log", "ログを書き出す", "Exporter le journal", "Экспортировать журнал"],
    "离开房间": ["Leave room", "ルームを出る", "Quitter la salle", "Покинуть комнату"],
    "写下这一轮你的角色要做什么…": [
      "What does your character do this round?",
      "このラウンドの行動を書いてください…",
      "Que fait votre personnage ce tour-ci ?",
      "Что делает ваш герой в этом раунде?",
    ],
    "等待房主开始…": ["Waiting for the host…", "ホストの開始待ち…", "En attente de l'hôte…", "Ожидание хоста…"],
    "写下你这一轮的行动。": ["Write your action for this round.", "このラウンドの行動を書いてください。", "Décrivez votre action pour ce tour.", "Опишите действие на этот раунд."],
    "你已提交行动，等待其他玩家或房主推进。": [
      "Action submitted. Waiting for other players or the host.",
      "行動を送信しました。他のプレイヤーまたはホストを待っています。",
      "Action envoyée. En attente des autres joueurs ou de l'hôte.",
      "Действие отправлено. Ждём других игроков или хоста.",
    ],
    "生命": ["HP", "生命", "PV", "HP"],
    "理智": ["SAN", "正気度", "Santé mentale", "Рассудок"],
    "随身钱": ["Money", "所持金", "Argent", "Деньги"],
    "已进行": ["Turns", "進行", "Tours", "Ходы"],
    "当前故事": ["Current story", "現在の物語", "Histoire actuelle", "Текущая история"],
    "已认识": ["Known people", "知り合い", "Personnes connues", "Знакомые"],
    "目标任务": ["Objectives", "目的", "Objectifs", "Цели"],
    "已触发事件": ["Triggered events", "発生イベント", "Événements déclenchés", "События"],
    "关系": ["Relation", "関係", "Relation", "Отношение"],
    "自动存档": ["Autosave", "自動保存", "Sauvegarde auto", "Автосохранение"],
    "作品标识": ["Work identity", "作品情報", "Identité de l'œuvre", "Сведения о работе"],
    "名称、分类、标签与简介": ["Title, genre, tags and summary", "タイトル・分類・タグ・概要", "Titre, genre, tags et résumé", "Название, жанр, теги и описание"],
    "剧本标题": ["Story title", "シナリオ名", "Titre du scénario", "Название сценария"],
    "必填": ["Required", "必須", "Obligatoire", "Обязательно"],
    "类型 / 分类": ["Type / genre", "種類 / 分類", "Type / genre", "Тип / жанр"],
    "一句话简介": ["One-line summary", "ひとこと概要", "Résumé en une ligne", "Краткое описание"],
    "叙事基调": ["Narrative tone", "作風・トーン", "Ton narratif", "Тон повествования"],
    "标签": ["Tags", "タグ", "Tags", "Теги"],
    "版本信息": ["Version information", "バージョン情報", "Informations de version", "Версия"],
    "版本号": ["Version", "バージョン", "Version", "Версия"],
    "版本描述": ["Version notes", "バージョン説明", "Notes de version", "Описание версии"],
    "世界框架": ["World framework", "世界設定", "Cadre du monde", "Основа мира"],
    "时代、地点、势力、规则与行动边界": [
      "Era, locations, factions, rules and action boundaries",
      "時代・場所・勢力・ルール・行動範囲",
      "Époque, lieux, factions, règles et limites d'action",
      "Эпоха, места, фракции, правила и границы действий",
    ],
    "世界设定": ["World setting", "世界設定", "Univers", "Мир"],
    "故事背景": ["Story background", "物語の背景", "Contexte", "Предыстория"],
    "幕后真相": ["Hidden truth", "裏の真実", "Vérité cachée", "Скрытая правда"],
    "开局位置": ["Starting state", "開始位置", "État initial", "Начальное положение"],
    "开局第几天": ["Starting day", "開始日", "Jour de départ", "Начальный день"],
    "开局时间": ["Starting time", "開始時刻", "Heure de départ", "Начальное время"],
    "开局地点": ["Starting location", "開始場所", "Lieu de départ", "Начальное место"],
    "随身物品": ["Starting items", "所持品", "Objets de départ", "Начальные предметы"],
    "玩家初始处境": ["Player's starting situation", "プレイヤーの初期状況", "Situation initiale", "Начальная ситуация игрока"],
    "固定开局描述": ["Fixed opening description", "固定開始の説明", "Description de l'ouverture fixe", "Описание фиксированного начала"],
    "开场白": ["Opening text", "導入文", "Texte d'ouverture", "Вступительный текст"],
    "原样呈现的开场文字": ["Opening text shown verbatim", "そのまま表示する導入文", "Texte d'ouverture affiché tel quel", "Вступительный текст без изменений"],
    "固定开局选项": ["Fixed opening options", "固定開始の選択肢", "Options d'ouverture fixe", "Варианты фиксированного начала"],
    "每个选项对应一种开局走向或既定后果": [
      "Each option defines a starting path or fixed consequence",
      "各選択肢は開始ルートまたは既定の結果に対応します",
      "Chaque option définit un départ ou une conséquence fixe",
      "Каждый вариант задаёт начало или фиксированное последствие",
    ],
    "骰子、固定开局与玩家可调整范围": [
      "Dice, fixed opening and player-controlled options",
      "ダイス・固定開始・プレイヤー調整範囲",
      "Dés, ouverture fixe et options ajustables",
      "Кости, фиксированное начало и доступные настройки",
    ],
    "默认开启骰子检定": ["Dice checks on by default", "判定を標準で有効", "Jets de dés activés par défaut", "Проверки включены по умолчанию"],
    "遇到有风险且结果不确定的行动时触发": [
      "Triggered when an action is risky and uncertain",
      "危険で結果が不確かな行動時に発生",
      "Déclenché pour une action risquée et incertaine",
      "Срабатывает при рискованном и неопределённом действии",
    ],
    "允许玩家切换骰子": ["Allow players to toggle dice", "プレイヤーの判定切替を許可", "Autoriser les joueurs à changer les dés", "Разрешить игрокам переключать кости"],
    "玩家可以在对局中自主开关检定": [
      "Players can enable or disable checks during play",
      "プレイ中に判定をオン・オフできます",
      "Les joueurs peuvent activer ou désactiver les jets",
      "Игроки могут включать и выключать проверки",
    ],
    "固定开局默认开启": ["Fixed opening on by default", "固定開始を標準で有効", "Ouverture fixe par défaut", "Фиксированное начало по умолчанию"],
    "允许玩家切换固定开局": ["Allow players to toggle fixed opening", "固定開始の切替を許可", "Autoriser le changement d'ouverture", "Разрешить менять фиксированное начало"],
    "启用随机机制": ["Enable random mechanics", "ランダム機構を有効化", "Activer les mécanismes aléatoires", "Включить случайные механизмы"],
    "实体组 → 实体 → 属性组 → 具体属性": ["Entity group → Entity → Attribute group → Attribute", "実体グループ → 実体 → 能力グループ → 能力", "Groupe → Entité → Attribut → Valeur", "Группа → Сущность → Атрибут → Значение"],
    "实体名录": ["Entity directory", "実体一覧", "Répertoire des entités", "Реестр сущностей"],
    "持续状态": ["Persistent states", "継続状態", "États persistants", "Постоянные состояния"],
    "相关人物": ["Relevant characters", "関連人物", "Personnages", "Персонажи"],
    "一次性的剧情点、线索池与可抵达的收束方式": [
      "One-off plot points, clue pool and possible endings",
      "一度きりの展開・手がかり・到達可能な結末",
      "Points d'intrigue uniques, indices et fins possibles",
      "Одноразовые события, улики и возможные финалы",
    ],
    "剧情点": ["Plot points", "物語ポイント", "Points d'intrigue", "Сюжетные точки"],
    "线索池": ["Clue pool", "手がかりプール", "Réserve d'indices", "Пул улик"],
    "结局方向": ["Ending directions", "結末の方向", "Directions des fins", "Варианты финалов"],
    "词条库": ["Lore library", "用語辞典", "Bibliothèque de lore", "Библиотека лора"],
    "预设行动": ["Preset actions", "定型行動", "Actions prédéfinies", "Готовые действия"],
    "骰池、修正值与分段结果，交给引擎执行": [
      "Dice pools, modifiers and result bands are resolved by the engine",
      "ダイス・修正値・結果範囲はエンジンが処理します",
      "Les dés, modificateurs et plages sont résolus par le moteur",
      "Кости, модификаторы и диапазоны обрабатывает движок",
    ],
    "随机项": ["Random tables", "ランダム項目", "Tables aléatoires", "Случайные таблицы"],
    "参考资料链接": ["Reference links", "参考リンク", "Liens de référence", "Справочные ссылки"],
    "迁入旧剧本": ["Import an older story", "旧シナリオを読み込む", "Importer un ancien scénario", "Импорт старого сценария"],
    "姓名": ["Name", "名前", "Nom", "Имя"],
    "所属势力": ["Faction", "所属勢力", "Faction", "Фракция"],
    "身份": ["Role", "身分", "Rôle", "Роль"],
    "初始态度": ["Initial attitude", "初期態度", "Attitude initiale", "Начальное отношение"],
    "公开描述": ["Public description", "公開情報", "Description publique", "Публичное описание"],
    "隐藏内情": ["Hidden information", "隠された事情", "Information cachée", "Скрытая информация"],
    "分类": ["Category", "分類", "Catégorie", "Категория"],
    "线索正文": ["Clue text", "手がかり本文", "Texte de l'indice", "Текст улики"],
    "第几天": ["Day", "日数", "Jour", "День"],
    "事件标题": ["Event title", "イベント名", "Titre de l'événement", "Название события"],
    "说明": ["Notes", "説明", "Notes", "Описание"],
    "结局名称": ["Ending name", "結末名", "Nom de la fin", "Название финала"],
    "达成条件": ["Conditions", "達成条件", "Conditions", "Условия"],
    "实体组": ["Entity group", "実体グループ", "Groupe d'entités", "Группа сущностей"],
    "实体名称": ["Entity name", "実体名", "Nom de l'entité", "Название сущности"],
    "实体类型": ["Entity type", "実体タイプ", "Type d'entité", "Тип сущности"],
    "信息": ["Info", "情報", "Information", "Информация"],
    "初始值": ["Initial value", "初期値", "Valeur initiale", "Начальное значение"],
    "简介": ["Summary", "概要", "Résumé", "Описание"],
    "设定": ["Setting", "設定", "Réglage", "Настройка"],
    "规则": ["Rules", "ルール", "Règles", "Правила"],
    "玩家实体": ["Player entity", "プレイヤー実体", "Entité joueur", "Сущность игрока"],
    "默认隐藏": ["Hidden by default", "標準で非表示", "Masqué par défaut", "Скрыто по умолчанию"],
    "初始可见": ["Visible initially", "初期表示", "Visible au départ", "Видно изначально"],
    "属性组 / 属性字段": ["Attribute groups / fields", "能力グループ / 項目", "Groupes / champs d'attributs", "Группы / поля атрибутов"],
    "＋ 添加属性": ["＋ Add attribute", "＋ 能力を追加", "＋ Ajouter un attribut", "＋ Добавить атрибут"],
    "状态名称": ["State name", "状態名", "Nom de l'état", "Название состояния"],
    "过期时间": ["Expires at", "終了条件", "Expiration", "Истекает"],
    "频率": ["Frequency", "頻度", "Fréquence", "Частота"],
    "下次触发": ["Next trigger", "次回発生", "Prochain déclenchement", "Следующее срабатывание"],
    "剧情点标题": ["Plot point title", "展開名", "Titre de l'intrigue", "Название события"],
    "触发时间": ["Trigger time", "発生時刻", "Moment de déclenchement", "Время срабатывания"],
    "生效效果": ["Effect", "効果", "Effet", "Эффект"],
    "内容": ["Content", "内容", "Contenu", "Содержание"],
    "层级路径": ["Hierarchy path", "階層パス", "Chemin hiérarchique", "Иерархический путь"],
    "词条标题": ["Lore title", "用語名", "Titre du lore", "Название лора"],
    "解释": ["Definition", "説明", "Définition", "Определение"],
    "按钮名称": ["Button label", "ボタン名", "Nom du bouton", "Название кнопки"],
    "行动类型": ["Action type", "行動タイプ", "Type d'action", "Тип действия"],
    "补充说明": ["Additional notes", "補足", "Notes complémentaires", "Дополнительно"],
    "行动文本": ["Action text", "行動テキスト", "Texte de l'action", "Текст действия"],
    "随机项名称": ["Random table name", "ランダム項目名", "Nom de la table", "Название таблицы"],
    "生效时机": ["Trigger condition", "発生条件", "Condition", "Условие"],
    "骰子数量": ["Dice count", "ダイス数", "Nombre de dés", "Количество костей"],
    "骰子面数": ["Die faces", "ダイス面数", "Faces du dé", "Граней на кости"],
    "修正值": ["Modifier", "修正値", "Modificateur", "Модификатор"],
    "随机项结果区间": ["Random result bands", "ランダム結果範囲", "Plages de résultat", "Диапазоны результатов"],
    "最小値": ["Minimum", "最小", "Minimum", "Минимум"],
    "最小值": ["Minimum", "最小", "Minimum", "Минимум"],
    "最大值": ["Maximum", "最大", "Maximum", "Максимум"],
    "命中结果": ["Result", "結果", "Résultat", "Результат"],
    "选项文字": ["Option text", "選択肢", "Texte de l'option", "Текст варианта"],
    "既定后果": ["Fixed consequence", "既定の結果", "Conséquence fixe", "Фиксированное последствие"],
    "保存前会检查标题和故事背景。": ["The editor checks the title and background before saving.", "保存前にタイトルと背景を確認します。", "Le titre et le contexte sont vérifiés avant l'enregistrement.", "Перед сохранением проверяются название и предыстория."],
    "展开": ["Expand", "展開", "Développer", "Развернуть"],
    "收起": ["Collapse", "折りたたむ", "Réduire", "Свернуть"],
    "自定义": ["Custom", "カスタム", "Personnalisé", "Свои"],
    "＋ 自己写一个剧本": ["＋ Write your own story", "＋ 自作シナリオ", "＋ Créer un scénario", "＋ Создать сценарий"],
    "SCENARIO WORKSPACE · 分层创作台": [
      "SCENARIO WORKSPACE · LAYERED EDITOR",
      "シナリオワークスペース · 階層エディター",
      "ATELIER DE SCÉNARIO · ÉDITEUR PAR COUCHES",
      "МАСТЕРСКАЯ СЦЕНАРИЯ · СЛОИ",
    ],
    "词条与行动": ["Lore and actions", "用語と行動", "Lore et actions", "Лор и действия"],
    "旧版 JSON 剧本可直接导入，字段会自动映射到对应层级。": [
      "Legacy JSON stories can be imported and mapped automatically.",
      "旧JSONシナリオを読み込むと、対応する階層へ自動変換されます。",
      "Les anciens scénarios JSON sont importés et associés automatiquement.",
      "Старые JSON-сценарии импортируются и распределяются автоматически.",
    ],
    "决定作品在剧本库与社区里的第一印象": [
      "Defines how the work appears in the library and community",
      "ライブラリとコミュニティでの第一印象を決めます",
      "Définit l'impression donnée dans la bibliothèque et la communauté",
      "Определяет первое впечатление в библиотеке и сообществе",
    ],
    "已开启": ["Open", "開いています", "Ouvert", "Открыто"],
    "已收起": ["Collapsed", "閉じています", "Réduit", "Свёрнуто"],
    "让玩家知道当前稿件处于哪一版": [
      "Shows players which revision they are using",
      "現在の版をプレイヤーに示します",
      "Indique aux joueurs la version utilisée",
      "Показывает игрокам текущую версию",
    ],
    "世界怎样运转，玩家第一眼看到什么": [
      "How the world works and what the player first sees",
      "世界の仕組みと最初に見えるもの",
      "Fonctionnement du monde et première impression",
      "Как устроен мир и что игрок видит вначале",
    ],
    "时间、地点、随身资源与玩家所处局面": [
      "Time, place, carried resources and the initial situation",
      "時間・場所・所持品・初期状況",
      "Temps, lieu, ressources et situation initiale",
      "Время, место, ресурсы и начальная ситуация",
    ],
    "留空则由 GM 根据世界和初始处境生成": [
      "Leave blank to let the GM generate it from the world and starting situation",
      "空欄なら世界観と初期状況からGMが生成します",
      "Laissez vide pour que le MJ le génère",
      "Оставьте пустым, чтобы ведущий создал начало",
    ],
    "＋ 添加固定开局选项": ["＋ Add fixed opening option", "＋ 固定開始の選択肢", "＋ Ajouter une option d'ouverture", "＋ Добавить вариант начала"],
    "开局按预设选项进行，减少随机偏离": [
      "Use preset opening options to reduce random drift",
      "開始を選択肢に沿って進め、逸脱を抑えます",
      "Démarrage sur options pour limiter les écarts",
      "Начало по вариантам, меньше случайных отклонений",
    ],
    "玩家可以改用自由开局": ["Players can switch to a free opening", "プレイヤーは自由開始に変更できます", "Les joueurs peuvent choisir une ouverture libre", "Игроки могут выбрать свободное начало"],
    "使用下方随机表和引擎掷骰结果": [
      "Use random tables below and engine-rolled results",
      "下のランダム表とエンジンの判定結果を使用",
      "Utiliser les tables et les jets du moteur",
      "Использовать таблицы и броски движка",
    ],
    "规则是剧本的默认状态；玩家的可调整范围由这些开关控制。": [
      "These are the default rules; the switches control what players may change.",
      "これらは既定ルールです。各スイッチでプレイヤーの変更範囲を決めます。",
      "Ce sont les règles par défaut ; les options définissent ce que les joueurs peuvent modifier.",
      "Это правила по умолчанию; переключатели задают доступные игроку изменения.",
    ],
    "实体可以是玩家、NPC、物品、地点或势力。展开实体后，可继续添加任意数量的属性组和属性字段。": [
      "Entities can be players, NPCs, items, places or factions. Expand one to add attribute groups and fields.",
      "実体はプレイヤー・NPC・物品・場所・勢力です。展開して能力グループと項目を追加できます。",
      "Une entité peut être un joueur, PNJ, objet, lieu ou faction. Ajoutez-y des groupes et champs d'attributs.",
      "Сущностью может быть игрок, NPC, предмет, место или фракция. Добавляйте группы и поля атрибутов.",
    ],
    "用“实体组”归类，用“属性组”继续细分": [
      "Group entities, then split attributes into smaller groups",
      "実体グループで分類し、能力グループで細分化",
      "Classez par groupe d'entités et de sous-attributs",
      "Группируйте сущности и атрибуты по уровням",
    ],
    "＋ 添加实体": ["＋ Add entity", "＋ 実体を追加", "＋ Ajouter une entité", "＋ Добавить сущность"],
    "中毒、追踪、祝福、警戒等跨回合状态": [
      "Cross-turn states such as poison, pursuit, blessing or alert",
      "毒・追跡・祝福・警戒など複数ターンの状態",
      "États persistants : poison, poursuite, bénédiction, alerte",
      "Состояния: яд, погоня, благословение, тревога",
    ],
    "＋ 添加持续状态": ["＋ Add persistent state", "＋ 継続状態を追加", "＋ Ajouter un état", "＋ Добавить состояние"],
    "NPC 的身份、立场、态度与隐藏内情": [
      "NPC identity, allegiance, attitude and hidden motives",
      "NPCの身分・立場・態度・隠された事情",
      "Identité, camp, attitude et secrets des PNJ",
      "Роль, сторона, отношение и тайны NPC",
    ],
    "关系会随对局中的互动而更新": [
      "Relationships update as the story progresses",
      "関係はセッション中の交流で更新されます",
      "Les relations évoluent pendant la partie",
      "Отношения меняются по ходу игры",
    ],
    "＋ 添加人物": ["＋ Add character", "＋ 人物を追加", "＋ Ajouter un personnage", "＋ Добавить персонажа"],
    "按天推进的时间表，以及循环发生的事件": [
      "A day-based timeline and recurring events",
      "日単位の予定表と循環イベント",
      "Chronologie quotidienne et événements récurrents",
      "Расписание по дням и повторяющиеся события",
    ],
    "触发后进入对局事件流，并同步到右侧状态栏": [
      "Triggered entries enter the game log and the side panel",
      "発生するとログと右側パネルに同期します",
      "Les entrées déclenchées apparaissent dans le journal et le panneau",
      "Событие попадает в журнал и правую панель",
    ],
    "0 个节点": ["0 entries", "0件", "0 entrée", "0 событий"],
    "＋ 添加时间节点": ["＋ Add time point", "＋ 時間イベントを追加", "＋ Ajouter un événement", "＋ Добавить событие"],
    "循环事件": ["Recurring events", "循環イベント", "Événements récurrents", "Повторяющиеся события"],
    "按天、周或月重复的钟声、潮汐、巡逻或仪式": [
      "Bells, tides, patrols or rituals repeating by day, week or month",
      "日・週・月ごとに繰り返す鐘・潮汐・巡回・儀式",
      "Cloches, marées, patrouilles ou rituels récurrents",
      "Звон, приливы, патрули или ритуалы по дням, неделям, месяцам",
    ],
    "＋ 添加循环事件": ["＋ Add recurring event", "＋ 循環イベントを追加", "＋ Ajouter un événement récurrent", "＋ Добавить повторяющееся событие"],
    "一次性的剧情点、线索池与可抵达的收束方式": [
      "One-off plot points, clues and reachable conclusions",
      "一度きりの展開・手がかり・到達できる結末",
      "Points d'intrigue, indices et conclusions possibles",
      "Разовые события, улики и возможные финалы",
    ],
    "在特定时间或条件下触发的一次性节点": [
      "One-off nodes triggered by time or conditions",
      "時間や条件で一度だけ発生する項目",
      "Éléments déclenchés une fois par le temps ou une condition",
      "Одноразовые события по времени или условию",
    ],
    "＋ 添加剧情点": ["＋ Add plot point", "＋ 展開を追加", "＋ Ajouter un point d'intrigue", "＋ Добавить событие"],
    "GM 只能通过场景和对话逐步放出": [
      "The GM reveals these gradually through scenes and dialogue",
      "GMは場面と会話を通して少しずつ提示します",
      "Le MJ les révèle progressivement",
      "Ведущий раскрывает их постепенно",
    ],
    "0 条": ["0 entries", "0件", "0 entrée", "0 записей"],
    "＋ 添加线索": ["＋ Add clue", "＋ 手がかりを追加", "＋ Ajouter un indice", "＋ Добавить улику"],
    "写出达成条件，避免故事无逻辑地突然结束": [
      "Define how endings are reached so the story does not stop arbitrarily",
      "結末条件を書き、不自然な打ち切りを防ぎます",
      "Définissez les conditions pour éviter une fin arbitraire",
      "Задайте условия, чтобы история не обрывалась произвольно",
    ],
    "0 个结局": ["0 endings", "0結末", "0 fin", "0 финалов"],
    "＋ 添加结局": ["＋ Add ending", "＋ 結末を追加", "＋ Ajouter une fin", "＋ Добавить финал"],
    "可检索的世界资料，以及一键填入的行动模板": [
      "Searchable world lore and one-click action templates",
      "検索できる世界資料と定型行動",
      "Lore consultable et actions préremplies",
      "Лор с поиском и готовые действия",
    ],
    "用“层级路径”组织世界、势力、人物、地点和物品": [
      "Use hierarchy paths to organise worlds, factions, people, places and items",
      "階層パスで世界・勢力・人物・場所・物品を整理します",
      "Organisez mondes, factions, personnes, lieux et objets par chemin hiérarchique",
      "Упорядочивайте миры, фракции, людей, места и предметы по пути",
    ],
    "＋ 添加词条": ["＋ Add lore entry", "＋ 用語を追加", "＋ Ajouter une entrée", "＋ Добавить запись"],
    "玩家可以直接点选，也可以自由输入": [
      "Players may click a preset or type freely",
      "定型行動を選ぶか自由入力できます",
      "Les joueurs peuvent cliquer ou écrire librement",
      "Игроки могут выбрать готовое действие или ввести своё",
    ],
    "0 个": ["0 items", "0件", "0 élément", "0 элементов"],
    "＋ 添加预设行动": ["＋ Add preset action", "＋ 定型行動を追加", "＋ Ajouter une action", "＋ Добавить действие"],
    "GM 只负责叙述，不得自行编造随机结果。每个随机项可继续添加多个结果区间。": [
      "The GM narrates only and must not invent random results. Add multiple result bands to each table.",
      "GMは語りのみを担当し、ランダム結果を創作しません。各項目に複数の結果範囲を追加できます。",
      "Le MJ raconte seulement et n'invente pas les résultats aléatoires. Ajoutez plusieurs plages par table.",
      "Ведущий только описывает события и не выдумывает случайные результаты. Можно добавить несколько диапазонов.",
    ],
    "名称 → 触发条件 → 骰池 → 结果区间": [
      "Name → trigger → dice pool → result bands",
      "名前 → 条件 → ダイス → 結果範囲",
      "Nom → condition → dés → plages de résultat",
      "Название → условие → кости → диапазоны",
    ],
    "＋ 添加随机项": ["＋ Add random table", "＋ ランダム項目を追加", "＋ Ajouter une table", "＋ Добавить таблицу"],
    "外部链接、正文抓取与旧剧本迁移": [
      "External links, content fetching and legacy story import",
      "外部リンク・本文取得・旧シナリオ移行",
      "Liens externes, récupération de contenu et import",
      "Ссылки, загрузка текста и импорт старых сценариев",
    ],
    "链接正文会随剧本保存，并作为 GM 的设定依据": [
      "Fetched link text is saved with the story and used as GM context",
      "取得した本文はシナリオと保存され、GMの設定資料になります",
      "Le texte récupéré est enregistré et utilisé par le MJ",
      "Загруженный текст сохраняется и используется ведущим",
    ],
    "每行一个公开链接": ["One public link per line", "公開リンクを1行1件", "Un lien public par ligne", "Одна публичная ссылка в строке"],
    "抓回来的正文会作为设定依据交给 GM": [
      "Fetched text will be supplied to the GM as setting material",
      "取得した本文は設定資料としてGMに渡されます",
      "Le texte récupéré sera fourni au MJ",
      "Загруженный текст будет передан ведущему",
    ],
    "导入后会自动映射到新的分层字段": [
      "Imported data is mapped to the new layered fields automatically",
      "読み込み後、新しい階層項目へ自動変換されます",
      "Les données sont associées aux nouveaux champs",
      "Данные автоматически распределяются по новым полям",
    ],
    "选择 JSON 文件": ["Choose JSON file", "JSONファイルを選択", "Choisir un fichier JSON", "Выберите JSON-файл"],
    "保存后可直接在剧本库中开始游玩，已发布版本不会被自动覆盖。": [
      "After saving, the story can be played immediately; published versions are not overwritten automatically.",
      "保存後すぐに遊べます。公開済みバージョンは自動上書きされません。",
      "Le scénario est jouable après sauvegarde ; les versions publiées ne sont pas écrasées.",
      "После сохранения можно сразу играть; опубликованные версии не перезаписываются.",
    ],
    "（还没有预设）": ["(No presets yet)", "（プリセットなし）", "(Aucun préréglage)", "(Пресетов пока нет)"],
    "体力、格斗、搬运重物": ["Endurance, fighting and lifting", "体力・格闘・重量物", "Endurance, combat et force physique", "Выносливость, драка и подъём тяжестей"],
    "身手、潜行、反应速度": ["Agility, stealth and reflexes", "身のこなし・隠密・反応速度", "Agilité, discrétion et réflexes", "Ловкость, скрытность и реакция"],
    "耐力、抗伤、意志力": ["Stamina, resilience and willpower", "耐久・耐傷・意志", "Endurance et résistance", "Стойкость и сопротивление"],
    "推理、学识、医术": ["Reasoning, lore and medicine", "推理・学識・医学", "Raisonnement, savoir et médecine", "Логика, знания и медицина"],
    "观察、聆听、直觉": ["Observation, listening and intuition", "観察・聞き耳・直感", "Observation, écoute et intuition", "Наблюдение, слух и интуиция"],
    "话术、交际、气场": ["Persuasion, social skill and presence", "話術・社交・存在感", "Persuasion, sociabilité et présence", "Убеждение, общение и харизма"],
    "漫威": ["Marvel", "マーベル", "Marvel", "Marvel"],
    "轻松": ["Easy", "やさしい", "Facile", "Лёгкая"],
    "标准": ["Normal", "標準", "Normale", "Обычная"],
    "硬核": ["Hardcore", "ハード", "Hardcore", "Хардкор"],
    "判定更容易，容错高": ["Easier checks and more room for mistakes", "判定が易しく失敗に余裕", "Jets plus faciles et plus tolérants", "Проверки легче, больше права на ошибку"],
    "常规难度": ["Standard difficulty", "標準難易度", "Difficulté normale", "Обычная сложность"],
    "判定更难，掉血掉理智更狠": ["Harder checks and harsher HP/SAN loss", "判定が難しくHP・正気度の損耗が大きい", "Jets plus durs et pertes plus sévères", "Проверки сложнее, потери HP/рассудка выше"],
    "例如：雪夜来客": ["e.g. A Guest in the Snow", "例：雪夜の来客", "ex. Un invité dans la neige", "например: Гость в снежную ночь"],
    "例如：沈聿": ["e.g. Shen Yu", "例：沈聿", "ex. Shen Yu", "например: Шэнь Юй"],
    "例如：男 / 女 / 不必称呼": ["e.g. man / woman / no title", "例：男性 / 女性 / 呼称不要", "ex. homme / femme / sans titre", "например: мужчина / женщина / без обращения"],
    "例如：民国 · 密室": ["e.g. Republic era · locked room", "例：民国・密室", "ex. époque républicaine · huis clos", "например: республиканская эпоха · запертая комната"],
    "剧本卡片上显示的故事引子": ["Story hook shown on the story card", "シナリオカードに表示する導入", "Accroche affichée sur la carte", "Завязка на карточке сценария"],
    "例如：冷、克制、压抑": ["e.g. cold, restrained, oppressive", "例：冷たい・抑制的・重苦しい", "ex. froid, retenu, oppressant", "например: холодно, сдержанно, давяще"],
    "悬疑, 民国, 单人（逗号分隔）": ["Mystery, Republic era, solo (comma-separated)", "ミステリー, 民国, ソロ（カンマ区切り）", "Mystère, époque républicaine, solo (virgules)", "Детектив, республика, одиночная (через запятую)"],
    "这一版新增、修正或平衡了什么": ["What changed or was balanced in this version", "この版で追加・修正・調整した内容", "Ce qui a changé ou été équilibré", "Что добавлено или изменено в версии"],
    "世界怎样运转、有哪些地点与势力、什么能做或不能做": [
      "How the world works, its places and factions, and what is possible",
      "世界の仕組み、場所と勢力、行動可能な範囲",
      "Fonctionnement du monde, lieux, factions et limites",
      "Как устроен мир, его места, фракции и границы возможного",
    ],
    "这是个什么地方、什么时候、发生了什么、玩家为什么在这里": [
      "Where and when this happens, what occurred, and why the player is here",
      "場所・時代・出来事・プレイヤーがいる理由",
      "Lieu, époque, événements et raison de la présence du joueur",
      "Где, когда, что случилось и почему здесь игрок",
    ],
    "GM 知道但不会直接说破的内幕；留空则由 GM 建立并保持一致": [
      "What the GM knows but will not reveal directly; leave blank to let the GM create it",
      "GMが知る裏設定。空欄ならGMが一貫して作成します",
      "Ce que le MJ sait sans le révéler ; laissez vide pour qu'il l'invente",
      "Тайна, известная ведущему; оставьте пустым, чтобы он её создал",
    ],
    "例如：雨夜中的陆宅前厅": ["e.g. the Lu mansion foyer on a rainy night", "例：雨夜の陸邸前庁", "ex. hall du manoir Lu sous la pluie", "например: холл усадьбы Лу в дождливую ночь"],
    "怀表, 折叠伞, 一封信": ["Pocket watch, folding umbrella, a letter", "懐中時計, 折りたたみ傘, 手紙", "Montre de gousset, parapluie pliant, une lettre", "Карманные часы, складной зонт, письмо"],
    "开局那一刻，玩家站在哪、手上有什么、正在面对什么": [
      "Where the player stands, what they carry and what they face",
      "開始時の立ち位置・所持品・直面していること",
      "Où se trouve le joueur, ce qu'il porte et ce qu'il affronte",
      "Где игрок, что у него в руках и с чем он столкнулся",
    ],
    "启用固定开局时，玩家只能从哪些起始选项中选择": [
      "Which fixed starting options the player may choose",
      "固定開始時に選べる開始選択肢",
      "Options de départ disponibles en ouverture fixe",
      "Какие стартовые варианты доступны при фиксированном начале",
    ],
    "想把开场写死，就把完整文字放在这里": [
      "Paste the full opening here if it must be exact",
      "固定の導入文をここに貼り付けます",
      "Collez ici le texte d'ouverture complet",
      "Вставьте сюда полный вступительный текст",
    ],
    "例如：28": ["e.g. 28", "例：28", "ex. 28", "например: 28"],
    "例如：报社记者": ["e.g. journalist", "例：新聞記者", "ex. journaliste", "например: журналист"],
    "衣着、体态、一眼会被记住的地方": [
      "Clothing, posture and memorable features",
      "服装・体格・印象的な特徴",
      "Vêtements, posture et traits marquants",
      "Одежда, осанка и заметные черты",
    ],
    "平时什么样，急起来什么样": ["How they usually behave and under pressure", "普段と追い詰められた時の様子", "Comportement habituel et sous pression", "Как ведёт себя обычно и под давлением"],
    "你从哪来，为什么到这里": ["Where you come from and why you are here", "出身とここに来た理由", "D'où vous venez et pourquoi", "Откуда вы и почему здесь"],
    "你最想弄清或得到什么": ["What you most want to discover or obtain", "最も知りたい／手に入れたいこと", "Ce que vous voulez découvrir ou obtenir", "Что вы хотите узнать или получить"],
    "预设名（存角色用）": ["Preset name (for saving)", "プリセット名（保存用）", "Nom du préréglage", "Название пресета"],
    "例如：K7M2Q": ["e.g. K7M2Q", "例：K7M2Q", "ex. K7M2Q", "например: K7M2Q"],
    "例如：阿棠": ["e.g. Atang", "例：阿棠", "ex. Atang", "например: Атан"],
    "例如：学徒": ["e.g. apprentice", "例：見習い", "ex. apprenti", "например: ученик"],
    "让别人快速认识你的角色": ["A quick introduction to your character", "キャラクターを簡単に紹介", "Présentez brièvement votre personnage", "Кратко представьте героя"],
    "你的昵称": ["Your nickname", "ニックネーム", "Votre pseudo", "Ваш никнейм"],
    "一句话介绍自己": ["Introduce yourself in one line", "ひとこと自己紹介", "Présentez-vous en une ligne", "Кратко расскажите о себе"],
    "只有你自己能看到的内容": ["Only you can see this", "自分だけが閲覧できます", "Vous seul pouvez le voir", "Видно только вам"],
    "可继续细分属性与初始值": [
      "Add attribute groups and initial values",
      "能力グループと初期値を追加できます",
      "Ajoutez des groupes et des valeurs initiales",
      "Добавляйте группы и начальные значения",
    ],
    "属性组": ["Attribute group", "能力グループ", "Groupe d'attributs", "Группа атрибутов"],
    "属性名称": ["Attribute name", "能力名", "Nom de l'attribut", "Название атрибута"],
    "属性规则": ["Attribute rule", "能力ルール", "Règle de l'attribut", "Правило атрибута"],
    "按掷骰总值判断结果": ["Result is determined by the rolled total", "ダイスの合計値で結果を判定", "Le total du jet détermine le résultat", "Результат определяется суммой броска"],
  };

  // Core Korean/German strings. Less common text is translated once through the server cache.
  const KO_DE = {
    "好评": ["좋아요", "Gefällt mir"],
    "差评": ["싫어요", "Gefällt mir nicht"],
    "留言板": ["게시판", "Feedback"],
    "我的": ["내 정보", "Profil"],
    "社区": ["커뮤니티", "Community"],
    "联机": ["멀티플레이", "Mehrspieler"],
    "反馈与留言": ["의견과 메시지", "Feedback und Nachrichten"],
    "发布": ["게시", "Veröffentlichen"],
    "关闭": ["닫기", "Schließen"],
    "保存": ["저장", "Speichern"],
    "删除": ["삭제", "Löschen"],
    "读取": ["불러오기", "Laden"],
    "清除": ["지우기", "Löschen"],
    "测试连接": ["연결 테스트", "Verbindung testen"],
    "保存资料": ["프로필 저장", "Profil speichern"],
    "进入我的私人空间": ["내 개인 공간 열기", "Meinen privaten Bereich öffnen"],
    "头像": ["아바타", "Avatar"],
    "昵称": ["닉네임", "Nickname"],
    "一句话个人简介": ["한 줄 소개", "Kurze Biografie"],
    "上传头像": ["아바타 업로드", "Avatar hochladen"],
    "主题色": ["강조 색상", "Akzentfarbe"],
    "网站主题": ["사이트 테마", "Website-Design"],
    "淡粉": ["연한 분홍", "Zartrosa"],
    "黄白": ["아이보리", "Warmes Elfenbein"],
    "界面字号": ["화면 글자 크기", "Schriftgröße"],
    "网站语言": ["웹사이트 언어", "Websitesprache"],
    "玩家状态栏": ["플레이어 패널", "Spielerleiste"],
    "缩小状态栏": ["플레이어 패널 축소", "Spielerleiste verkleinern"],
    "切换半透明": ["패널 투명도 변경", "Transparenz ändern"],
    "隐藏状态栏": ["플레이어 패널 숨기기", "Spielerleiste ausblenden"],
    "显示玩家状态栏": ["플레이어 패널 표시", "Spielerleiste anzeigen"],
    "状态栏": ["플레이어 패널", "Spielerleiste"],
    "状态": ["상태", "Status"],
    "关闭状态面板": ["상태 패널 닫기", "Statusfenster schließen"],
    "四、玩法与难度": ["4. 모드와 난이도", "4. Modus und Schwierigkeit"],
    "四、玩法": ["4. 모드", "4. Modus"],
    "网站默认选项（按剧本自动推荐，可随时切换）": ["사이트 기본 옵션(시나리오별 추천, 언제든 변경)", "Website-Standard (je nach Szenario, jederzeit änderbar)"],
    "跑团规则（有判定与代价）": ["TRPG 규칙(판정과 대가)", "Tischrollenspiel (Proben und Konsequenzen)"],
    "自由探索（ARPG：不掷骰，但有世界、任务、NPC 与成长）": ["자유 탐험(ARPG: 주사위 없이 세계·임무·NPC·성장)", "Freie Erkundung (ARPG: ohne Würfel, mit Welt, Aufgaben, NPCs und Entwicklung)"],
    "高级 GM 控制台": ["고급 GM 콘솔", "Erweiterte GM-Konsole"],
    "查看网站 GM 核心规则（只读）": ["사이트 GM 핵심 규칙 보기(읽기 전용)", "GM-Kernregeln anzeigen (schreibgeschützt)"],
    "快速方案": ["빠른 프리셋", "Schnellvoreinstellungen"],
    "均衡": ["균형", "Ausgewogen"],
    "沉浸": ["몰입", "Immersiv"],
    "硬核": ["하드코어", "Hardcore"],
    "自由探索": ["자유 탐험", "Freie Erkundung"],
    "跑团规则": ["TRPG 규칙", "Tischrollenspiel-Regeln"],
    "轻松": ["가벼움", "Leicht"],
    "启用高级 GM 配置": ["고급 GM 설정 사용", "Erweiterte GM-Einstellungen aktivieren"],
    "个人提示词注入": ["개인 프롬프트 주입", "Persönliche Prompt-Injektion"],
    "保存并应用": ["저장 및 적용", "Speichern und anwenden"],
    "恢复默认": ["기본값 복원", "Standard wiederherstellen"],
    "全部": ["전체", "Alle"],
    "历史": ["역사", "Historie"],
    "奇幻": ["판타지", "Fantasy"],
    "科幻": ["SF", "Science-Fiction"],
    "现实": ["현실", "Realismus"],
    "言情": ["로맨스", "Romantik"],
    "脑洞": ["기발한 상상", "Verrückte Ideen"],
    "玄幻": ["동양 판타지", "Mystische Fantasy"],
    "仙侠": ["선협", "Xianxia"],
    "怪谈": ["괴담", "Seltsame Geschichten"],
    "悬疑": ["미스터리", "Mystery"],
    "搜索": ["검색", "Suchen"],
    "创作社区": ["창작 커뮤니티", "Kreativ-Community"],
    "玩家自由创作游玩": ["플레이어 창작 플레이", "Spielerisches Erschaffen"],
    "社区网站平台": ["커뮤니티 플랫폼", "Community-Plattform"],
    "＋ 写一个新剧本": ["＋ 새 시나리오", "＋ Neues Szenario"],
    "去创作社区": ["창작 커뮤니티로", "Zur Community"],
    "我的空间": ["내 공간", "Mein Bereich"],
    "一、选剧本": ["1. 시나리오 선택", "1. Szenario wählen"],
    "加入剧本": ["시나리오 참가", "Szenario beitreten"],
    "当前剧本": ["현재 시나리오", "Ausgewähltes Szenario"],
    "← 返回剧本列表": ["← 시나리오 목록으로", "← Zurück zur Szenarioliste"],
    "请先选择一个剧本": ["먼저 시나리오를 선택하세요", "Zuerst ein Szenario wählen"],
    "选中后进入角色创建": ["선택 후 캐릭터 생성으로 이동합니다", "Nach der Auswahl geht es zur Charaktererstellung"],
    "原创": ["오리지널", "Original"],
    "同人": ["팬 창작", "Fan-Werk"],
    "墨绿": ["먹빛 녹색", "Tintengrün"],
    "暖褐": ["따뜻한 갈색", "Warmbraun"],
    "夜蓝": ["밤색 파랑", "Nachtblau"],
    "紫夜": ["보랏빛 밤", "Violettnacht"],
    "纯黑": ["순수 검정", "Reinschwarz"],
    "排序": ["정렬", "Sortieren"],
    "最新": ["최신", "Neueste"],
    "最热": ["인기", "Beliebt"],
    "评论排序": ["댓글 정렬", "Kommentarreihenfolge"],
    "回复": ["답글", "Antworten"],
    "点赞": ["좋아요", "Gefällt mir"],
    "收藏": ["즐겨찾기", "Favorit"],
    "转发": ["공유", "Teilen"],
    "评论": ["댓글", "Kommentar"],
    "编辑": ["편집", "Bearbeiten"],
    "发送": ["보내기", "Senden"],
    "详情": ["상세", "Details"],
    "可编辑": ["편집 가능", "Bearbeitbar"],
    "作者": ["작성자", "Autor"],
    "匿名作者": ["익명 작성자", "Anonymer Autor"],
    "玩家互动": ["플레이어 상호작용", "Spielerinteraktion"],
    "封面待补充": ["표지 준비 중", "Cover folgt"],
    "还没有评论，来聊一聊你的想法。": [
      "아직 댓글이 없습니다. 생각을 남겨 보세요.",
      "Noch keine Kommentare. Teile deine Meinung.",
    ],
    "剧本链接已复制": ["시나리오 링크를 복사했습니다", "Szenariolink kopiert"],
    "对剧本发表评论…": ["시나리오에 댓글 작성…", "Szenario kommentieren…"],
    "作者署名（封面公开）": ["작성자 표기 (표지 공개)", "Urheberangabe (öffentlich auf dem Cover)"],
    "填写你自己的公开笔名": ["공개 필명을 입력하세요", "Öffentlichen Autorennamen eingeben"],
    "一键发布到社区": ["커뮤니티에 공개", "In der Community veröffentlichen"],
    "发布到社区": ["커뮤니티에 공개", "In der Community veröffentlichen"],
    "分享剧本页面": ["시나리오 페이지 공유", "Szenarioseite teilen"],
    "打开剧本页面": ["시나리오 페이지 열기", "Szenarioseite öffnen"],
    "打开剧本": ["시나리오 열기", "Szenario öffnen"],
    "剧本页面链接已复制": ["시나리오 페이지 링크를 복사했습니다", "Szenariolink kopiert"],
    "已打开系统分享": ["공유 메뉴를 열었습니다", "Freigabemenü geöffnet"],
    "已取消分享": ["공유를 취소했습니다", "Teilen abgebrochen"],
    "正在发布到社区…": ["커뮤니티에 공개 중…", "Wird in der Community veröffentlicht…"],
    "已发布到创作社区。": ["창작 커뮤니티에 공개했습니다.", "In der Kreativ-Community veröffentlicht."],
    "社区推广信息已更新。": ["커뮤니티 홍보 정보를 업데이트했습니다.", "Community-Präsentation aktualisiert."],
    "漫威": ["Marvel", "Marvel"],
    "自己写一个剧本": ["새 시나리오 작성", "Szenario erstellen"],
    "编辑选中的自定义剧本": ["선택한 시나리오 편집", "Ausgewähltes Szenario bearbeiten"],
    "删除选中的自定义剧本": ["선택한 시나리오 삭제", "Ausgewähltes Szenario löschen"],
    "分享到社区": ["커뮤니티에 공유", "In der Community teilen"],
    "二、写你的角色": ["2. 캐릭터 작성", "2. Charakter erstellen"],
    "姓名 *": ["이름 *", "Name *"],
    "称呼 / 性别": ["호칭 / 성별", "Anrede / Geschlecht"],
    "年龄": ["나이", "Alter"],
    "身份职业": ["신분 / 직업", "Rolle / Beruf"],
    "外貌": ["외모", "Aussehen"],
    "性格": ["성격", "Persönlichkeit"],
    "背景": ["배경", "Hintergrund"],
    "能力": ["능력", "Fähigkeiten"],
    "目标 / 动机": ["목표 / 동기", "Ziel / Motivation"],
    "保存这个角色": ["캐릭터 저장", "Charakter speichern"],
    "三、分配属性（共 30 点，每项 1-10）": [
      "3. 능력치 배분 (총 30점, 항목당 1–10)",
      "3. Attribute verteilen (30 Punkte, je 1–10)",
    ],
    "随机分配": ["무작위 배분", "Zufällig verteilen"],
    "重置为 5": ["5로 초기화", "Auf 5 zurücksetzen"],
    "四、难度": ["4. 난이도", "4. Schwierigkeit"],
    "玩法": ["모드", "Modus"],
    "开始游戏": ["게임 시작", "Spiel starten"],
    "继续上次的游戏": ["이전 게임 계속", "Letztes Spiel fortsetzen"],
    "属性": ["능력치", "Attribute"],
    "生命": ["생명", "Leben"],
    "理智": ["정신력", "Verstand"],
    "随身钱": ["소지금", "Bargeld"],
    "已进行": ["진행한 턴", "Runden"],
    "技能值": ["기술", "Fertigkeiten"],
    "探索": ["탐험", "Erkundung"],
    "当前位置": ["현재 위치", "Standort"],
    "等级": ["레벨", "Stufe"],
    "经验": ["경험치", "Erfahrung"],
    "主动掷骰": ["직접 판정", "Manuelle Probe"],
    "背包": ["소지품", "Inventar"],
    "线索": ["단서", "Hinweise"],
    "重要经历": ["중요한 이력", "Wichtige Ereignisse"],
    "人物关系": ["인물 관계", "Beziehungen"],
    "当前目标": ["현재 목표", "Aktuelle Ziele"],
    "（重要经历会随着你的行动在这里形成）": [
      "(행동에 따라 중요한 이력이 여기에 기록됩니다)",
      "(Wichtige Ereignisse entstehen hier durch deine Handlungen.)",
    ],
    "设定（下一回合生效）": ["설정 (다음 턴부터)", "Einstellungen (ab nächster Runde)"],
    "自动存档": ["자동 저장", "Automatisch speichern"],
    "开场": ["도입", "Einstieg"],
    "导出": ["내보내기", "Exportieren"],
    "存档": ["저장", "Speichern"],
    "读档": ["불러오기", "Laden"],
    "重新开始": ["다시 시작", "Neu starten"],
    "退出": ["나가기", "Beenden"],
    "观察四周": ["주변 둘러보기", "Umsehen"],
    "找人搭话": ["누군가와 대화", "Jemanden ansprechen"],
    "梳理线索": ["단서 정리", "Hinweise ordnen"],
    "休息一会儿": ["잠시 휴식", "Kurz ausruhen"],
    "行动": ["행동", "Handeln"],
    "开始行动": ["행동 시작", "Beginnen"],
    "属性": ["능력치", "Attribute"],
    "力量": ["근력", "Stärke"],
    "敏捷": ["민첩", "Geschicklichkeit"],
    "体质": ["내구", "Konstitution"],
    "智力": ["지능", "Intelligenz"],
    "感知": ["지각", "Wahrnehmung"],
    "魅力": ["매력", "Charisma"],
    "侦查": ["수색", "Untersuchen"],
    "聆听": ["청각", "Zuhören"],
    "话术": ["설득", "Überzeugen"],
    "威吓": ["위협", "Einschüchtern"],
    "格斗": ["격투", "Nahkampf"],
    "潜行": ["은신", "Schleichen"],
    "身手": ["곡예", "Akrobatik"],
    "学识": ["학식", "Wissen"],
    "医术": ["의술", "Medizin"],
    "意志": ["의지", "Willenskraft"],
    "单人": ["싱글 플레이", "Einzelspieler"],
    "多人": ["멀티 플레이", "Mehrspieler"],
    "创作系统": ["창작 시스템", "Kreativsystem"],
    "基本力量": ["기본 능력", "Grundwerte"],
    "未记录": ["미기록", "Nicht erfasst"],
    "轻松": ["쉬움", "Leicht"],
    "标准": ["표준", "Normal"],
    "硬核": ["하드코어", "Hardcore"],
  };

  const PATTERNS = [
    [/^第 (\d+) \/ (\d+) 页$/, ["Page $1 / $2", "$1 / $2ページ", "Page $1 / $2", "Стр. $1 / $2"]],
    [/^第 (\d+) 回合(?: · (.*))?$/, ["Turn $1$2", "$1ターン$2", "Tour $1$2", "Ход $1$2"]],
    [/^([力敏体智感魅])(\d+)$/, ["$1$2", "$1$2", "$1$2", "$1$2"]],
    [/^(\d+) 个日程节点$/, ["$1 schedule points", "予定 $1件", "$1 étapes", "$1 событий"]],
    [/^已分配 (\d+) \/ 30 点$/, ["Assigned $1 / 30", "$1 / 30 配分済み", "$1 / 30 attribués", "Распределено $1 / 30"]],
    [/^人物 (\d+) · 实体 (\d+) · 状态 (\d+) · 线索 (\d+)$/, ["Characters $1 · Entities $2 · States $3 · Clues $4", "人物 $1・実体 $2・状態 $3・手がかり $4", "Personnages $1 · Entités $2 · États $3 · Indices $4", "Персонажи $1 · Объекты $2 · Состояния $3 · Улики $4"]],
    [/^时间节点 (\d+) · 循环事件 (\d+) · 剧情点 (\d+) · 结局 (\d+)$/, ["Time points $1 · Loops $2 · Plot points $3 · Endings $4", "時間 $1・循環 $2・物語 $3・結末 $4", "Temps $1 · Boucles $2 · Intrigue $3 · Fins $4", "Время $1 · Циклы $2 · Сюжет $3 · Финалы $4"]],
    [/^词条 (\d+) · 预设行动 (\d+) · 随机项 (\d+) · 参考链接 (\d+)$/, ["Lore $1 · Actions $2 · Random tables $3 · Links $4", "用語 $1・行動 $2・ランダム $3・リンク $4", "Lore $1 · Actions $2 · Aléatoire $3 · Liens $4", "Лор $1 · Действия $2 · Случайное $3 · Ссылки $4"]],
    [/^生命 (.+) → (.+)$/, ["HP $1 → $2", "HP $1 → $2", "PV $1 → $2", "HP $1 → $2"]],
    [/^理智 (.+) → (.+)$/, ["SAN $1 → $2", "正気度 $1 → $2", "Santé mentale $1 → $2", "Рассудок $1 → $2"]],
    [/^钱 ([+-]?\d+)（现有 (\d+)）$/, ["Money $1 (now $2)", "所持金 $1（現在 $2）", "Argent $1 (actuel $2)", "Деньги $1 (сейчас $2)"]],
    [/^获得线索：(.+)$/, ["Clue found: $1", "手がかり獲得：$1", "Indice trouvé : $1", "Найдена улика: $1"]],
    [/^获得物品：(.+)$/, ["Item gained: $1", "アイテム獲得：$1", "Objet obtenu : $1", "Получен предмет: $1"]],
    [/^失去物品：(.+)$/, ["Item lost: $1", "アイテム喪失：$1", "Objet perdu : $1", "Потерян предмет: $1"]],
    [/^新目标：(.+)$/, ["New objective: $1", "新しい目的：$1", "Nouvel objectif : $1", "Новая цель: $1"]],
    [/^完成目标：(.+)$/, ["Objective complete: $1", "目的達成：$1", "Objectif accompli : $1", "Цель выполнена: $1"]],
    [/^地点：(.+)$/, ["Location: $1", "場所：$1", "Lieu : $1", "Место: $1"]],
    [/^接取任务：(.+)$/, ["Quest accepted: $1", "依頼受注：$1", "Quête acceptée : $1", "Задание принято: $1"]],
    [/^完成任务：(.+)$/, ["Quest complete: $1", "依頼達成：$1", "Quête terminée : $1", "Задание выполнено: $1"]],
    [/^结识：(.+)$/, ["Met: $1", "知り合った：$1", "Rencontre : $1", "Знакомство: $1"]],
    [/^经验 \+(\d+)（Lv\.(.+)）$/, ["XP +$1 (Lv.$2)", "経験値 +$1（Lv.$2）", "XP +$1 (Niv.$2)", "Опыт +$1 (Ур.$2)"]],
    [/^时间推进 (\d+) 分钟 → (.+)$/, ["Time +$1 min → $2", "時間 +$1分 → $2", "Temps +$1 min → $2", "Время +$1 мин → $2"]],
    [/^人物关系：(.+)$/, ["Relationship: $1", "人物関係：$1", "Relation : $1", "Отношение: $1"]],
    [/^还有 (\d+) 分钟$/, ["In $1 min", "あと$1分", "Dans $1 min", "Через $1 мин"]],
    [/^已到点$/, ["Due now", "時間です", "Maintenant", "Уже пора"]],
    [/^第 (\d+) 天$/, ["Day $1", "$1日目", "Jour $1", "День $1"]],
    [/^(\d+) 项$/, ["$1 items", "$1件", "$1 élément(s)", "$1 элементов"]],
    [/^(\d+) 个实体$/, ["$1 entities", "実体 $1件", "$1 entité(s)", "$1 сущностей"]],
    [/^(\d+) 人$/, ["$1 people", "$1人", "$1 personne(s)", "$1 человек"]],
    [/^(\d+) 个时间节点$/, ["$1 time points", "時間イベント $1件", "$1 événement(s)", "$1 событий"]],
    [/^(\d+) 项循环事件$/, ["$1 recurring events", "循環イベント $1件", "$1 événement(s) récurrent(s)", "$1 повторяющихся событий"]],
    [/^(\d+) 个剧情点$/, ["$1 plot points", "展開 $1件", "$1 point(s) d'intrigue", "$1 сюжетных точек"]],
  ];

  const textState = new WeakMap();
  const attrState = new WeakMap();
  const SKIP = [
    "script",
    "style",
    "#log .seg.player",
    ".player",
    ".fb-item",
    ".cm-item",
    ".post",
    "[data-no-i18n]",
  ].join(",");

  const REMOTE_SKIP = [
    "script",
    "style",
    "textarea",
    "input",
    "select",
    "#log .seg.player",
    ".fb-item",
    ".cm-item",
    ".post",
    "[data-no-i18n]",
  ].join(",");

  const TRADITIONAL_PHRASES = {
    剧本: "劇本",
    设定: "設定",
    简体中文: "簡體中文",
    个人: "個人",
    关系: "關係",
    网站: "網站",
    联机: "聯機",
    创建: "建立",
    数据: "資料",
    链接: "連結",
    词条: "詞條",
    进度: "進度",
    时间: "時間",
    开始: "開始",
    结束: "結束",
    选择: "選擇",
    随机: "隨機",
    触发: "觸發",
    选项: "選項",
    状态: "狀態",
    默认: "預設",
    内容: "內容",
    简介: "簡介",
    标题: "標題",
    角色: "角色",
    经历: "經歷",
    改变: "改變",
    发生: "發生",
    处理: "處理",
    后端: "後端",
    服务器: "伺服器",
    记录: "記錄",
    恢复: "恢復",
    备份: "備份",
    费用: "費用",
    风险: "風險",
    繁体: "繁體",
    联系: "聯絡",
    里面: "裡面",
    说话: "說話",
    这里: "這裡",
    那里: "那裡",
  };

  const S2T = Object.fromEntries(
    Object.entries({
      万: "萬", 与: "與", 专: "專", 业: "業", 东: "東", 丝: "絲", 丢: "丟", 两: "兩", 严: "嚴", 个: "個",
      丰: "豐", 临: "臨", 为: "為", 义: "義", 乌: "烏", 乐: "樂", 乔: "喬", 习: "習", 乡: "鄉", 书: "書",
      买: "買", 乱: "亂", 争: "爭", 于: "於", 亏: "虧", 云: "雲", 亚: "亞", 产: "產", 亩: "畝", 亲: "親",
      亿: "億", 仅: "僅", 从: "從", 仓: "倉", 仪: "儀", 们: "們", 价: "價", 众: "眾", 优: "優", 会: "會",
      伞: "傘", 伟: "偉", 传: "傳", 伤: "傷", 伦: "倫", 伪: "偽", 体: "體", 余: "餘", 佣: "傭", 侠: "俠",
      侣: "侶", 侣: "侶", 侦: "偵", 侧: "側", 侨: "僑", 俩: "倆", 债: "債", 倾: "傾", 偿: "償", 储: "儲",
      儿: "兒", 党: "黨", 入: "入", 关: "關", 兴: "興", 养: "養", 兽: "獸", 内: "內", 册: "冊", 写: "寫",
      军: "軍", 农: "農", 冲: "衝", 决: "決", 况: "況", 冻: "凍", 净: "淨", 减: "減", 凑: "湊", 准: "準",
      几: "幾", 凤: "鳳", 凭: "憑", 击: "擊", 划: "劃", 则: "則", 刚: "剛", 创: "創", 删: "刪", 别: "別",
      剧: "劇", 劝: "勸", 办: "辦", 务: "務", 动: "動", 劲: "勁", 劳: "勞", 势: "勢", 勋: "勳", 医: "醫",
      华: "華", 协: "協", 单: "單", 卖: "賣", 卢: "盧", 卫: "衛", 却: "卻", 厂: "廠", 厅: "廳", 历: "歷",
      压: "壓", 厌: "厭", 厕: "廁", 县: "縣", 参: "參", 双: "雙", 发: "發", 变: "變", 叠: "疊", 号: "號",
      叹: "嘆", 吓: "嚇", 吗: "嗎", 听: "聽", 启: "啟", 员: "員", 响: "響", 哑: "啞", 唤: "喚", 团: "團",
      园: "園", 围: "圍", 图: "圖", 圆: "圓", 圣: "聖", 场: "場", 坏: "壞", 块: "塊", 坚: "堅", 坛: "壇",
      坟: "墳", 坠: "墜", 垒: "壘", 垦: "墾", 执: "執", 坚: "堅", 声: "聲", 壳: "殼", 处: "處", 备: "備",
      复: "複", 够: "夠", 头: "頭", 夹: "夾", 夺: "奪", 奖: "獎", 妇: "婦", 妈: "媽", 娱: "娛", 婴: "嬰",
      宁: "寧", 宝: "寶", 实: "實", 审: "審", 宪: "憲", 宫: "宮", 宽: "寬", 宾: "賓", 对: "對", 寻: "尋",
      导: "導", 寿: "壽", 将: "將", 尔: "爾", 尘: "塵", 尝: "嘗", 层: "層", 属: "屬", 岁: "歲", 岂: "豈",
      峡: "峽", 币: "幣", 帅: "帥", 师: "師", 帐: "帳", 带: "帶", 帮: "幫", 广: "廣", 庆: "慶", 库: "庫",
      应: "應", 庙: "廟", 庞: "龐", 废: "廢", 开: "開", 异: "異", 弃: "棄", 张: "張", 弹: "彈", 强: "強",
      归: "歸", 当: "當", 录: "錄", 彻: "徹", 径: "徑", 忆: "憶", 忧: "憂", 怀: "懷", 态: "態", 总: "總",
      恋: "戀", 恳: "懇", 恼: "惱", 悬: "懸", 惊: "驚", 惧: "懼", 惨: "慘", 惩: "懲", 愿: "願", 懒: "懶",
      戏: "戲", 战: "戰", 户: "戶", 扎: "紮", 扑: "撲", 执: "執", 扩: "擴", 扫: "掃", 扬: "揚", 扰: "擾",
      报: "報", 担: "擔", 拟: "擬", 拥: "擁", 择: "擇", 挂: "掛", 挥: "揮", 损: "損", 换: "換", 据: "據",
      掷: "擲", 插: "插", 搜: "搜", 摄: "攝", 摆: "擺", 摇: "搖", 撑: "撐", 撤: "撤", 撷: "擷", 敌: "敵",
      数: "數", 断: "斷", 无: "無", 旧: "舊", 时: "時", 显: "顯", 晋: "晉", 晒: "曬", 晓: "曉", 术: "術",
      机: "機", 杀: "殺", 杂: "雜", 权: "權", 条: "條", 来: "來", 杨: "楊", 极: "極", 构: "構", 枪: "槍",
      标: "標", 树: "樹", 样: "樣", 桥: "橋", 检: "檢", 楼: "樓", 欢: "歡", 欧: "歐", 残: "殘", 历: "歷",
      归: "歸", 气: "氣", 汇: "匯", 汉: "漢", 汤: "湯", 沟: "溝", 没: "沒", 泪: "淚", 测: "測", 济: "濟",
      浓: "濃", 涛: "濤", 润: "潤", 涨: "漲", 渐: "漸", 温: "溫", 湾: "灣", 满: "滿", 滤: "濾", 灭: "滅",
      灯: "燈", 灵: "靈", 灾: "災", 炼: "煉", 烂: "爛", 烟: "煙", 热: "熱", 爱: "愛", 牵: "牽", 犹: "猶",
      狮: "獅", 独: "獨", 狱: "獄", 猎: "獵", 献: "獻", 环: "環", 现: "現", 玛: "瑪", 画: "畫", 疗: "療",
      盘: "盤", 监: "監", 盖: "蓋", 确: "確", 礼: "禮", 祸: "禍", 离: "離", 种: "種", 称: "稱", 积: "積",
      稳: "穩", 穷: "窮", 窗: "窗", 笔: "筆", 筑: "築", 筛: "篩", 签: "簽", 简: "簡", 类: "類", 粮: "糧",
      紧: "緊", 约: "約", 级: "級", 纪: "紀", 纯: "純", 纳: "納", 纵: "縱", 纷: "紛", 纸: "紙", 线: "線",
      练: "練", 组: "組", 细: "細", 织: "織", 终: "終", 经: "經", 结: "結", 绝: "絕", 统: "統", 续: "續",
      维: "維", 综: "綜", 绿: "綠", 缓: "緩", 编: "編", 缘: "緣", 缩: "縮", 网: "網", 罗: "羅", 罚: "罰",
      义: "義", 习: "習", 翻: "翻", 联: "聯", 职: "職", 聪: "聰", 肠: "腸", 肤: "膚", 胜: "勝", 脚: "腳",
      脸: "臉", 舖: "舖", 艺: "藝", 节: "節", 苏: "蘇", 药: "藥", 获: "獲", 营: "營", 蓝: "藍", 虽: "雖",
      虫: "蟲", 蛮: "蠻", 补: "補", 装: "裝", 见: "見", 观: "觀", 规: "規", 觉: "覺", 览: "覽", 触: "觸",
      计: "計", 订: "訂", 认: "認", 讨: "討", 让: "讓", 训: "訓", 议: "議", 记: "記", 讲: "講", 许: "許",
      论: "論", 设: "設", 访: "訪", 证: "證", 评: "評", 识: "識", 诉: "訴", 词: "詞", 译: "譯", 试: "試",
      话: "話", 详: "詳", 语: "語", 说: "說", 请: "請", 读: "讀", 课: "課", 谢: "謝", 调: "調", 谈: "談",
      请: "請", 谋: "謀", 谓: "謂", 谜: "謎", 象: "象", 贝: "貝", 负: "負", 贡: "貢", 财: "財", 责: "責",
      败: "敗", 货: "貨", 质: "質", 贩: "販", 贪: "貪", 贫: "貧", 购: "購", 贯: "貫", 贴: "貼", 贵: "貴",
      费: "費", 贺: "賀", 资: "資", 赛: "賽", 赞: "讚", 赢: "贏", 赶: "趕", 趋: "趨", 车: "車", 轨: "軌",
      转: "轉", 轻: "輕", 载: "載", 较: "較", 辆: "輛", 输: "輸", 辞: "辭", 边: "邊", 达: "達", 迁: "遷",
      过: "過", 运: "運", 还: "還", 进: "進", 远: "遠", 违: "違", 连: "連", 迟: "遲", 适: "適", 选: "選",
      递: "遞", 逻: "邏", 遗: "遺", 邮: "郵", 邻: "鄰", 释: "釋", 针: "針", 钟: "鐘", 钢: "鋼", 钱: "錢",
      铁: "鐵", 银: "銀", 错: "錯", 键: "鍵", 长: "長", 门: "門", 闭: "閉", 问: "問", 间: "間", 闻: "聞",
      阅: "閱", 阳: "陽", 阴: "陰", 阵: "陣", 阶: "階", 际: "際", 陆: "陸", 陈: "陳", 险: "險", 随: "隨",
      隐: "隱", 难: "難", 雾: "霧", 静: "靜", 页: "頁", 顶: "頂", 项: "項", 顺: "順", 须: "須", 预: "預",
      领: "領", 频: "頻", 题: "題", 颜: "顏", 额: "額", 风: "風", 飞: "飛", 饭: "飯", 马: "馬", 验: "驗",
      骑: "騎", 鱼: "魚", 鸟: "鳥", 鸡: "雞", 黄: "黃", 齐: "齊", 龄: "齡", 龙: "龍",
    }),
  );

  const REMOTE_CACHE_KEY = "pt-i18n-remote-v1";
  let remoteCache = (() => {
    try {
      const saved = JSON.parse(localStorage.getItem(REMOTE_CACHE_KEY) || "{}");
      return new Map(Object.entries(saved || {}));
    } catch {
      return new Map();
    }
  })();
  const remoteMisses = new Set();
  let remoteTimer = 0;
  let remoteToken = 0;
  let remoteRunning = false;
  let allowRemoteModelCall = false;
  let translationStatusNode = null;

  const TRANSLATION_STATUS = {
    "zh-Hant": "正在轉換頁面內容…",
    en: "Translating page content…",
    ja: "ページ内容を翻訳しています…",
    ko: "페이지 내용을 번역하는 중…",
    de: "Seiteninhalt wird übersetzt…",
    fr: "Traduction du contenu…",
    ru: "Перевод содержимого страницы…",
  };

  function normalizeLanguage(value) {
    const lang = String(value || "").trim().toLowerCase().replace(/_/g, "-");
    if (["zh", "zh-hans", "zh-cn", "zh-sg"].includes(lang)) return "zh-Hans";
    if (["zh-hant", "zh-tw", "zh-hk", "zh-mo"].includes(lang)) return "zh-Hant";
    return SUPPORTED.includes(lang) ? lang : "zh-Hans";
  }

  function toTraditional(value) {
    let out = String(value || "");
    for (const [from, to] of Object.entries(TRADITIONAL_PHRASES)) out = out.split(from).join(to);
    return out.replace(/[\u3400-\u9fff]/g, (char) => S2T[char] || char);
  }

  let cacheDirty = false;
  let cacheTimer = 0;

  function flushRemoteCache() {
    if (cacheTimer) {
      clearTimeout(cacheTimer);
      cacheTimer = 0;
    }
    if (!cacheDirty) return;
    cacheDirty = false;
    const write = () => localStorage.setItem(REMOTE_CACHE_KEY, JSON.stringify(Object.fromEntries(remoteCache)));
    try {
      write();
    } catch {
      // localStorage 满了：砍掉一半最旧的再试一次
      try {
        const excess = Math.ceil(remoteCache.size / 2);
        let count = 0;
        for (const oldKey of remoteCache.keys()) {
          remoteCache.delete(oldKey);
          if (++count >= excess) break;
        }
        write();
      } catch {}
    }
  }

  /** 原来每翻译一条就整表序列化写入，一条长句就能同步卡住主线程；改成合并写入。 */
  function cacheRemote(key, translated) {
    remoteCache.set(key, translated);
    if (remoteCache.size > 1600) {
      const excess = remoteCache.size - 1600;
      let count = 0;
      for (const oldKey of remoteCache.keys()) {
        remoteCache.delete(oldKey);
        if (++count >= excess) break;
      }
    }
    cacheDirty = true;
    if (!cacheTimer) cacheTimer = setTimeout(flushRemoteCache, 400);
  }

  window.addEventListener("pagehide", flushRemoteCache);

  function showTranslationStatus(text) {
    if (!TRANSLATION_STATUS[current]) return;
    if (!translationStatusNode) {
      translationStatusNode = document.createElement("div");
      translationStatusNode.id = "pt-i18n-status";
      translationStatusNode.setAttribute("role", "status");
      translationStatusNode.setAttribute("aria-live", "polite");
      Object.assign(translationStatusNode.style, {
        position: "fixed",
        left: "50%",
        bottom: "18px",
        transform: "translateX(-50%)",
        zIndex: "120",
        padding: "7px 13px",
        borderRadius: "999px",
        background: "rgba(20, 23, 32, .94)",
        color: "#f0f1f5",
        border: "1px solid #3b4358",
        boxShadow: "0 8px 26px rgba(0,0,0,.32)",
        fontSize: "12px",
        pointerEvents: "none",
      });
      document.body.appendChild(translationStatusNode);
    }
    translationStatusNode.textContent = text || TRANSLATION_STATUS[current];
    translationStatusNode.style.display = "block";
  }

  function hideTranslationStatus() {
    if (translationStatusNode) translationStatusNode.style.display = "none";
  }

  let current = (() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return normalizeLanguage(saved);
    } catch {
      return "zh-Hans";
    }
  })();

  function interpolate(template, match) {
    return template.replace(/\$(\d+)/g, (_, index) => match[Number(index)] || "");
  }

  const staticMemo = new Map();

  /** 同一句在一页里会被反复请求，字典/正则结果放进内存缓存，避免重复匹配。 */
  function translate(value) {
    if (current === "zh-Hans" || !value) return value;
    const lead = value.match(/^\s*/)?.[0] || "";
    const trail = value.match(/\s*$/)?.[0] || "";
    const key = value.trim();
    if (!key) return value;
    const cached = remoteCache.get(current + "\n" + key);
    if (cached) return lead + cached + trail;
    const memoKey = current + "\n" + value;
    const hit = staticMemo.get(memoKey);
    if (hit !== undefined) return hit;
    const out = translateStatic(value);
    if (staticMemo.size > 4000) staticMemo.clear();
    staticMemo.set(memoKey, out);
    return out;
  }

  function translateStatic(value) {
    if (current === "zh-Hans" || !value) return value;
    const lead = value.match(/^\s*/)?.[0] || "";
    const trail = value.match(/\s*$/)?.[0] || "";
    const key = value.trim();
    if (!key) return value;
    const cached = remoteCache.get(`${current}\n${key}`);
    if (cached) return lead + cached + trail;
    if (current === "zh-Hant") return lead + toTraditional(key) + trail;
    const index = { en: 0, ja: 1, fr: 2, ru: 3 }[current];
    if (D[key] && index != null && D[key][index]) return lead + D[key][index] + trail;
    if (KO_DE[key]) return lead + KO_DE[key][current === "ko" ? 0 : 1] + trail;
    const byline = key.match(/^作者 · (.+)$/);
    if (byline) {
      const label = { en: "Author", ja: "作者", ko: "작성자", de: "Autor", fr: "Auteur", ru: "Автор" }[current];
      return lead + `${label} · ${byline[1]}` + trail;
    }
    const authorLabel = key.match(/^作者 (.+)$/);
    if (authorLabel) {
      const label = { en: "Author", ja: "作者", ko: "작성자", de: "Autor", fr: "Auteur", ru: "Автор" }[current];
      return lead + `${label}: ${authorLabel[1]}` + trail;
    }
    const attr = key.match(/^([力敏体智感魅])(\d+)$/);
    if (attr) {
      const letters = {
        力: { en: "STR", ja: "力", ko: "근력", de: "STÄ", fr: "FOR", ru: "СИЛ" },
        敏: { en: "DEX", ja: "敏", ko: "민첩", de: "GES", fr: "DEX", ru: "ЛОВ" },
        体: { en: "CON", ja: "体", ko: "내구", de: "KON", fr: "CON", ru: "ТЕЛ" },
        智: { en: "INT", ja: "知", ko: "지능", de: "INT", fr: "INT", ru: "ИНТ" },
        感: { en: "PER", ja: "感", ko: "지각", de: "WAH", fr: "PER", ru: "ВОС" },
        魅: { en: "CHA", ja: "魅", ko: "매력", de: "CHA", fr: "CHA", ru: "ОБА" },
      };
      return lead + letters[attr[1]][current] + attr[2] + trail;
    }
    const derived = key.match(/^标准难度下：初始生命 (\d+)，初始理智 (\d+)。技能判定＝d20＋对应属性，对比如上难度。$/);
    if (derived && index != null) {
      const text = [
        `At normal difficulty: starting HP ${derived[1]}, starting SAN ${derived[2]}. Skill checks = d20 + attribute against the difficulty above.`,
        `標準難易度：初期HP ${derived[1]}、初期正気度 ${derived[2]}。技能判定＝d20＋能力値で上記難易度と比較します。`,
        `Difficulté normale : PV initiaux ${derived[1]}, santé mentale ${derived[2]}. Jet = d20 + attribut contre la difficulté ci-dessus.`,
        `Обычная сложность: начальное HP ${derived[1]}, рассудок ${derived[2]}. Проверка = d20 + характеристика против сложности выше.`,
      ][index];
      return lead + text + trail;
    }
    if (index != null) {
      for (const [pattern, translated] of PATTERNS) {
        const match = key.match(pattern);
        if (match) return lead + interpolate(translated[index], match) + trail;
      }
    }
    const countLabels = {
      en: "schedule points",
      ja: "予定",
      ko: "개 일정",
      de: "Zeitpunkte",
      fr: "étapes",
      ru: "событий",
    };
    return value.replace(/(\d+) 个日程节点/g, `$1 ${countLabels[current]}`);
  }

  function skipped(node) {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return Boolean(element?.closest(SKIP));
  }

  function translateTextNode(node) {
    if (!node.nodeValue || node.nodeValue.trim().length < 2 || skipped(node)) return;
    let state = textState.get(node);
    if (!state || state.last !== node.nodeValue) state = { source: node.nodeValue, last: null };
    const next = translate(state.source);
    if (node.nodeValue !== next) node.nodeValue = next;
    state.last = next;
    textState.set(node, state);
  }

  function translateAttributes(element) {
    if (skipped(element)) return;
    let state = attrState.get(element);
    if (!state) {
      state = new Map();
      attrState.set(element, state);
    }
    for (const name of ["placeholder", "title", "alt", "aria-label"]) {
      if (!element.hasAttribute(name)) continue;
      const value = element.getAttribute(name);
      const saved = state.get(name);
      if (!saved || saved.last !== value) {
        state.set(name, { source: value, last: null });
      }
      const item = state.get(name);
      const next = translate(item.source);
      if (value !== next) element.setAttribute(name, next);
      item.last = next;
    }
  }

  /** checkVisibility 不会触发完整布局计算，getClientRects() 每个节点调一次代价太高。 */
  function isVisible(node) {
    if (!node || !node.isConnected) return false;
    if (typeof node.checkVisibility === "function") {
      try {
        return node.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true });
      } catch {}
    }
    return true;
  }

  const MAX_SCAN_NODES = 5000;
  const MAX_SCAN_TEXTS = 240;

  function collectRemote(root, texts) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      const element = root.parentElement;
      if (!element || !isVisible(element) || element.closest(REMOTE_SKIP)) return;
      const value = root.nodeValue.trim();
      if (/[\u3400-\u9fff]/.test(value) && !remoteCache.has(`${current}\n${value}`) && !remoteMisses.has(`${current}\n${value}`)) {
        texts.add(value);
      }
      return;
    }
    if (root.nodeType === Node.ELEMENT_NODE) {
      if (isVisible(root) && !root.closest(REMOTE_SKIP)) {
        for (const name of ["placeholder", "title", "alt", "aria-label"]) {
          const value = root.getAttribute(name)?.trim();
          if (value && /[\u3400-\u9fff]/.test(value) && !remoteCache.has(`${current}\n${value}`) && !remoteMisses.has(`${current}\n${value}`)) {
            texts.add(value);
          }
        }
      }
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    let scanned = 0;
    while (node && scanned < MAX_SCAN_NODES && texts.size < MAX_SCAN_TEXTS) {
      scanned += 1;
      if (node.nodeType === Node.TEXT_NODE) {
        const element = node.parentElement;
        if (element && isVisible(element) && !element.closest(REMOTE_SKIP)) {
          const value = node.nodeValue.trim();
          if (/[\u3400-\u9fff]/.test(value) && !remoteCache.has(`${current}\n${value}`) && !remoteMisses.has(`${current}\n${value}`)) {
            texts.add(value);
          }
        }
      } else if (isVisible(node) && !node.closest(REMOTE_SKIP)) {
        for (const name of ["placeholder", "title", "alt", "aria-label"]) {
          const value = node.getAttribute(name)?.trim();
          if (value && /[\u3400-\u9fff]/.test(value) && !remoteCache.has(`${current}\n${value}`) && !remoteMisses.has(`${current}\n${value}`)) {
            texts.add(value);
          }
        }
      }
      node = walker.nextNode();
    }
  }

  async function translateRemoteBatch(language, texts, token, allowModel) {
    const response = await fetch("/api/i18n/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ language, texts, cachedOnly: !allowModel }),
    });
    if (!response.ok) throw new Error(`translation ${response.status}`);
    const data = await response.json();
    if (token !== remoteToken || language !== current) return;
    for (const [source, translated] of Object.entries(data.translations || {})) {
      if (translated) cacheRemote(`${language}\n${source}`, translated);
    }
  }

  async function runRemoteTranslation() {
    if (current === "zh-Hans" || current === "zh-Hant") {
      hideTranslationStatus();
      return;
    }
    if (remoteRunning) {
      scheduleRemoteTranslation(1400);
      return;
    }
    remoteRunning = true;
    const token = ++remoteToken;
    const language = current;
    try {
      const texts = new Set();
      collectRemote(document.documentElement, texts);
      const batch = [...texts].slice(0, 36);
      if (!batch.length) {
        hideTranslationStatus();
        return;
      }
      showTranslationStatus();
      try {
        await translateRemoteBatch(language, batch, token, allowRemoteModelCall);
      } catch {
        for (const text of batch) remoteMisses.add(`${language}\n${text}`);
      }
      if (token === remoteToken && language === current) apply();
    } finally {
      remoteRunning = false;
      if (token === remoteToken) hideTranslationStatus();
    }
  }

  function scheduleRemoteTranslation(delay = 450) {
    clearTimeout(remoteTimer);
    remoteTimer = setTimeout(runRemoteTranslation, delay);
  }

  function apply(root = document.documentElement) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      translateTextNode(root);
      return;
    }
    if (root.nodeType === Node.ELEMENT_NODE) translateAttributes(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node) {
      if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
      else translateAttributes(node);
      node = walker.nextNode();
    }
  }

  function syncPickers() {
    document.querySelectorAll("#lang-select, #game-lang-select, [data-language-select]").forEach((picker) => {
      if (picker.value !== current) picker.value = current;
    });
  }

  function setLanguage(language, options = {}) {
    const next = normalizeLanguage(language);
    current = next;
    staticMemo.clear();
    allowRemoteModelCall = false;
    hideTranslationStatus();
    document.documentElement.lang = next === "zh-Hans" ? "zh-CN" : next === "zh-Hant" ? "zh-TW" : next;
    apply();
    syncPickers();
    scheduleRemoteTranslation();
    if (!options.silent) {
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {}
      window.dispatchEvent(new CustomEvent("pt-language-changed", { detail: { language: next } }));
    }
  }

  function bindPickers() {
    document.querySelectorAll("#lang-select, #game-lang-select, [data-language-select]").forEach((picker) => {
      if (picker.dataset.ptLangBound) return;
      picker.dataset.ptLangBound = "1";
      picker.addEventListener("change", () => setLanguage(picker.value, { allowRemoteModel: true }));
    });
  }

  const observer = new MutationObserver((records) => {
    let shouldTranslateRemote = false;
    for (const record of records) {
      if (record.type === "characterData") translateTextNode(record.target);
      else {
        for (const node of record.addedNodes) {
          apply(node);
          shouldTranslateRemote = true;
        }
        if (record.type === "attributes") translateAttributes(record.target);
      }
    }
    if (shouldTranslateRemote) scheduleRemoteTranslation();
  });

  function boot() {
    bindPickers();
    setLanguage(current, { silent: true });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["placeholder", "title", "alt", "aria-label"],
    });
    document.addEventListener("click", () => scheduleRemoteTranslation(650), true);
  }

  window.PT_I18N = {
    supported: SUPPORTED,
    names: LANGUAGE_NAMES,
    getLanguage: () => current,
    setLanguage,
    translate,
    apply,
    scheduleRemoteTranslation,
  };
  window.ptT = translate;
  window.ptLang = () => current;

  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY && event.newValue) setLanguage(event.newValue, { silent: true });
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
