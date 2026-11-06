/** All user-visible strings live here (requirements FR-076). Russian only; used by main and renderer. */
export const ru = {
  app: {
    name: 'BranchChat',
    tagline: 'Обсуждения с ветвлением — прямо из выделенного текста.',
    version: (v: string): string => `Версия ${v}`
  },
  launcher: {
    newDiscussion: 'Новое обсуждение',
    openDiscussion: 'Открыть обсуждение…',
    dropHint: 'Или перетащите файл .branchchat в это окно.'
  },
  nameDialog: {
    title: 'Как вас зовут?',
    explanation: 'Это имя будет показано рядом с вашими сообщениями. Его можно изменить позже.',
    label: 'Ваше имя',
    confirm: 'Продолжить',
    cancel: 'Отмена'
  },
  discussion: {
    windowTitle: (fileName: string, unread = 0): string =>
      unread > 0 ? `(${unread}) ${fileName} — BranchChat` : `${fileName} — BranchChat`,
    empty: 'Пока нет сообщений. Напишите первое.',
    saved: 'Сохранено',
    saving: 'Сохранение…',
    saveFailed: (reason: string): string => `Не удалось сохранить: ${reason}`,
    retry: 'Повторить',
    dismiss: 'Скрыть'
  },
  composer: {
    placeholder: 'Напишите сообщение…',
    send: 'Отправить',
    hint: 'Ctrl+Enter — отправить',
    ariaLabel: 'Текст сообщения',
    cannotSend: 'Не удалось подготовить сообщение к отправке.'
  },
  editor: {
    toolbar: 'Форматирование',
    heading: (level: number): string => `Заголовок ${level}`,
    bold: 'Жирный (Ctrl+B)',
    italic: 'Курсив (Ctrl+I)',
    underline: 'Подчёркнутый (Ctrl+U)',
    bulletList: 'Маркированный список',
    orderedList: 'Нумерованный список',
    indent: 'Увеличить отступ (Tab)',
    outdent: 'Уменьшить отступ (Shift+Tab)',
    textColor: 'Цвет текста',
    backgroundColor: 'Цвет фона',
    noColor: 'Без цвета',
    link: 'Ссылка (Ctrl+K)',
    undo: 'Отменить (Ctrl+Z)',
    redo: 'Повторить (Ctrl+Y)',
    colorNames: {
      '#d32f2f': 'Красный',
      '#ef6c00': 'Оранжевый',
      '#2e7d32': 'Зелёный',
      '#1565c0': 'Синий',
      '#6a1b9a': 'Фиолетовый',
      '#616161': 'Серый',
      '#fff59d': 'Жёлтый',
      '#c8e6c9': 'Светло-зелёный',
      '#bbdefb': 'Голубой',
      '#f8bbd0': 'Розовый',
      '#ffe0b2': 'Персиковый',
      '#e0e0e0': 'Светло-серый'
    } as Record<string, string>
  },
  images: {
    insert: 'Вставить изображение…',
    uploading: 'Добавление изображения…',
    unavailable: 'Изображение недоступно',
    unavailableHint: 'Данные изображения отсутствуют в файле или повреждены.',
    view: 'Открыть изображение',
    viewerTitle: 'Изображение',
    close: 'Закрыть',
    pickTitle: 'Выберите изображение',
    pickFilter: 'Изображения'
  },
  linkDialog: {
    title: 'Ссылка',
    label: 'Текст ссылки',
    url: 'Адрес',
    apply: 'Применить',
    remove: 'Убрать ссылку',
    cancel: 'Отмена',
    invalidUrl: 'Допустимы только адреса http, https и электронная почта (mailto).'
  },
  unread: {
    label: 'Новое',
    markRead: 'Отметить прочитанным',
    markThread: 'Отметить сообщения этой ветки прочитанными',
    markAll: 'Отметить всё прочитанным',
    total: (n: number): string => `Непрочитано: ${n}`,
    inThread: (n: number): string => `Непрочитано здесь: ${n}`,
    descendantsHint: 'Есть непрочитанные сообщения в дочерних ветках',
    panelCount: (n: number): string => `Непрочитанных: ${n}`
  },
  readStatus: {
    none: 'Пока никто не прочитал',
    some: 'Прочитали не все',
    all: 'Прочитали все',
    readBy: 'Прочитали',
    notReadBy: 'Не прочитали',
    nobody: 'никто',
    close: 'Закрыть',
    ariaLabel: 'Кто прочитал это сообщение'
  },
  readNotice: {
    title: 'Отметки о прочтении видны другим',
    text: 'Какие сообщения вы прочитали, сохраняется в файле обсуждения. Все, у кого есть этот файл, увидят ваши отметки о прочтении. Это показывается один раз.',
    confirm: 'Понятно',
    cancel: 'Отмена'
  },
  branches: {
    panelTitle: 'Ветки',
    mainThread: 'Основное обсуждение',
    active: 'Активные',
    closed: 'Закрытые',
    noBranches: 'Веток пока нет. Выделите текст в сообщении и нажмите «Ответить на это».',
    replyToThis: 'Ответить на это',
    replyHint: 'Создать ветку от выделенного фрагмента',
    pathLabel: 'Путь',
    titleLabel: 'Название ветки',
    titlePlaceholder: 'Название (необязательно)',
    close: 'Закрыть ветку',
    reopen: 'Открыть ветку снова',
    goToSource: 'К исходному сообщению',
    quoteLabel: 'Цитата',
    contextDivider: 'Ответы в этой ветке',
    contextCaption: 'Предыдущие сообщения (только чтение)',
    closedNotice: 'Эта ветка закрыта. Откройте её снова, чтобы написать в ней.',
    belongsTo: (label: string): string => `из ветки «${label}»`,
    branchCount: (n: number): string =>
      n === 1 ? '1 ветка' : `${n} ${n < 5 && n > 1 ? 'ветки' : 'веток'}`,
    openBranch: (label: string): string => `Открыть ветку «${label}»`,
    messageCount: (n: number): string => String(n)
  },
  message: {
    linkTitle: (href: string): string => `Открыть: ${href}`
  },
  notices: {
    twoCopies: (otherPath: string, thisPath: string): string =>
      `Это же обсуждение уже открыто из другого файла. Открытый ранее файл: ${otherPath}. Этот файл: ${thisPath}. Копии не объединяются.`
  },
  menu: {
    file: 'Файл',
    newDiscussion: 'Новое обсуждение',
    open: 'Открыть…',
    closeWindow: 'Закрыть окно',
    exit: 'Выход',
    edit: 'Правка',
    undo: 'Отменить',
    redo: 'Повторить',
    cut: 'Вырезать',
    copy: 'Копировать',
    paste: 'Вставить',
    selectAll: 'Выделить всё',
    help: 'Справка',
    about: 'О программе'
  },
  dialogs: {
    saveTitle: 'Новое обсуждение',
    openTitle: 'Открыть обсуждение',
    fileFilter: 'Обсуждения BranchChat',
    defaultFileName: 'Новое обсуждение',
    openFailedTitle: 'Не удалось открыть обсуждение',
    createFailedTitle: 'Не удалось создать обсуждение',
    fileAlreadyOpen: 'Этот файл уже открыт в BranchChat. Выберите другое имя файла.',
    closeTitle: 'Закрыть обсуждение?',
    closeUnsentDraft: 'В поле ввода есть неотправленное сообщение. Оно будет потеряно.',
    closeSaveFailed:
      'Последние изменения не удалось сохранить в файл. Если закрыть окно, они будут потеряны.',
    closeConfirm: 'Закрыть',
    closeCancel: 'Отмена',
    nameRequired: 'Сначала укажите своё имя.'
  },
  /** Messages for document errors, keyed by DocumentError code. */
  errors: {
    NOT_FOUND: 'Файл не найден.',
    ACCESS_DENIED:
      'Нет доступа к файлу. Возможно, он открыт в другой программе или защищён от записи.',
    NOT_AN_ARCHIVE: 'Файл повреждён или не является обсуждением BranchChat.',
    UNSAFE_ENTRY: 'Файл содержит небезопасные данные и не будет открыт.',
    DUPLICATE_ENTRY: 'Файл повреждён: в нём повторяются записи.',
    MISSING_ENTRY: 'Файл повреждён: в нём не хватает данных.',
    INVALID_JSON: 'Файл повреждён: данные обсуждения нечитаемы.',
    INVALID_SCHEMA: 'Файл не соответствует формату BranchChat.',
    INVALID_STRUCTURE: 'Файл повреждён: данные обсуждения противоречивы.',
    UNSUPPORTED_VERSION:
      'Обсуждение создано более новой версией BranchChat. Обновите приложение, чтобы его открыть.',
    UNSUPPORTED_IMAGE: 'Поддерживаются только изображения PNG, JPEG, GIF и WebP.',
    ASSET_MISMATCH: 'Изображение в файле повреждено.',
    WRITE_FAILED: 'Не удалось записать файл.',
    NAME_REQUIRED: 'Сначала укажите своё имя.',
    IMAGE_READ_FAILED: 'Не удалось прочитать файл изображения.',
    READ_NOTICE_REQUIRED: 'Сначала подтвердите уведомление об отметках о прочтении.',
    THREAD_CLOSED: 'Ветка закрыта. Откройте её, чтобы написать в ней.',
    INVALID_SELECTION: 'Не удалось определить выделенный фрагмент. Выделите текст ещё раз.',
    EMPTY_QUOTE: 'Выделите текст, от которого нужно создать ветку.',
    THREAD_NOT_FOUND: 'Ветка не найдена.',
    MESSAGE_NOT_FOUND: 'Сообщение не найдено.',
    NO_DOCUMENT: 'Нет открытого обсуждения.',
    UNKNOWN: 'Произошла непредвиденная ошибка.'
  } as Record<string, string>
} as const

export function describeError(code: string | undefined): string {
  return ru.errors[code ?? 'UNKNOWN'] ?? ru.errors['UNKNOWN']!
}
