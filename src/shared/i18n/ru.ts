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
    windowTitle: (fileName: string): string => `${fileName} — BranchChat`,
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
    hint: 'Ctrl+Enter — отправить'
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
    NO_DOCUMENT: 'Нет открытого обсуждения.',
    UNKNOWN: 'Произошла непредвиденная ошибка.'
  } as Record<string, string>
} as const

export function describeError(code: string | undefined): string {
  return ru.errors[code ?? 'UNKNOWN'] ?? ru.errors['UNKNOWN']!
}
