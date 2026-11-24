import type { Texts } from './texts'

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many)

/** "1.5 MB", "320 KB", "12 B". */
function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/** All user-visible strings in English (FR-291). The keys are the keys of `ru.ts` (a type check and a unit test). */
export const en: Texts = {
    app: {
        name: 'BranchChat',
        tagline: 'Discussions that branch, right from the selected text.',
        version: (v) => `Version ${v}`
    },
    launcher: {
        newDiscussion: 'New discussion',
        newShared: 'New shared discussion…',
        joinShared: 'Join a shared discussion…',
        empty: 'There are no discussions yet. Create a discussion on this computer, create a shared discussion, or join a shared discussion by invitation.',
        openDiscussion: 'Import file…',
        dropHint: 'Or drag a .branchchat file into this window.',
        shared: 'shared',
        noMessages: 'no messages'
    },
    migration: {
        title: 'Move discussions into the library',
        text: 'BranchChat now keeps discussions itself; .branchchat files are only for exchange and backups. Select the discussions to move. The files themselves do not change and are not deleted.',
        missing: 'file not found',
        backupHint:
            'Tip: in Settings you can choose a folder for backups of the library, for example in OneDrive or Google Drive.',
        run: 'Move',
        running: 'Moving…',
        skip: 'Do not move',
        imported: 'moved',
        merged: 'merged with a discussion that was moved before',
        failed: 'not moved',
        originalsKept:
            'The original files stay where they are. You can import them again at any time.',
        done: 'Done'
    },
    library: {
        openFailed:
            'The discussion library cannot be opened. The details are in the log in the folder %APPDATA%\\BranchChat\\logs.',
        damaged: 'The discussion library is damaged',
        damagedWithBackup: (date) =>
            `You can restore the last backup of ${date}. Changes after it are lost. The damaged library file stays in the folder %APPDATA%\\BranchChat.`,
        damagedNoBackup:
            'There are no backups. You can start with an empty library and import .branchchat files. The damaged library file stays in the folder %APPDATA%\\BranchChat.',
        restoreLast: 'Restore the backup',
        startEmpty: 'Start with an empty library',
        quit: 'Exit'
    },
    backup: {
        heading: 'Backups',
        explanation:
            'Once a day BranchChat saves a copy of all discussions in the folder %APPDATA%\\BranchChat\\backups (the last 7 copies). If you choose one more folder, for example in OneDrive or Google Drive, the copies go there too.',
        notEncrypted:
            'The copies contain the messages without encryption. The private encryption keys are not in the copies.',
        last: (date) => `Last backup: ${date}`,
        never: 'No backups yet.',
        folder: 'Additional folder:',
        noFolder: 'not chosen',
        pickFolder: 'Choose folder…',
        clearFolder: 'Do not use',
        now: 'Back up now',
        running: 'Saving the backup…',
        done: (date) => `Backup saved: ${date}.`,
        folderFailed: (message) =>
            `The backup is in the app folder, but not in the chosen folder: ${message}`,
        restore: 'Restore from backup…',
        folderTitle: 'Folder for backups',
        cloudWarningTitle: 'Backups in the cloud',
        cloudWarning:
            'The backups contain all messages without encryption. If the folder is in cloud storage (OneDrive, Google Drive, Dropbox), the cloud service can read the messages.',
        cloudContinue: 'Use this folder',
        cloudCancel: 'Cancel',
        restoreTitle: 'Restore from backup',
        restoreHint:
            'Choose a backup. The current library is first saved as one more backup, then BranchChat restarts.',
        restoreNone: 'No backups yet.',
        restoreConfirm: 'Restore',
        restoreCancel: 'Cancel',
        restoreQuestion: 'Restore the library from the backup?',
        restoreDetail: (date) =>
            `The backup of ${date} is restored. The current library is kept as a backup. BranchChat restarts.`,
        placeApp: 'app folder',
        placeFolder: 'chosen folder',
        reasons: {
            daily: 'daily',
            manual: 'manual',
            migration: 'before an update',
            restore: 'before a restore'
        },
        counts: (discussions, messages) => `discussions: ${discussions}, messages: ${messages}`
    },
    recent: {
        menuTitle: 'Open recent',
        menuEmpty: 'The list is empty',
        jumpListCategory: 'Recent'
    },
    branchMap: {
        title: 'Branch map',
        onlyOpen: 'Open only',
        onlyUnread: 'With unread',
        open: 'open',
        closed: 'closed',
        messages: 'Messages in the branch',
        count: (n) => `${n} ${plural(n, 'message', 'messages')}`,
        close: 'Close',
        button: 'Branch map'
    },
    search: {
        placeholder: 'Find in discussion',
        allTitle: 'Search in all discussions',
        allPlaceholder: 'Find in all discussions',
        open: 'Find',
        close: 'Close search',
        next: 'Next',
        previous: 'Previous',
        count: (current, total) => `${current} of ${total}`,
        nothing: 'Nothing found',
        main: 'Main discussion',
        branch: (name) => `branch “${name}”`,
        branchTitle: 'branch title',
        hint: 'Case does not matter; “ё” and “е” are the same letter; each word is found by its start.',
        searchAll: 'Search in all discussions'
    },
    sidebar: {
        title: 'Discussions',
        filter: 'Find a discussion',
        sort: 'Order',
        byActivity: 'Newest messages first',
        byName: 'By name',
        hide: 'Collapse the discussion list',
        show: 'Expand the discussion list',
        add: 'Add a discussion',
        menu: 'Actions of the discussion list',
        open: 'Open',
        archive: 'Archive',
        restore: 'Restore from the archive',
        remove: 'Delete…',
        archived: 'Archive',
        unread: (n) => `unread: ${n}`,
        choose: 'Select a discussion in the list on the left. To add a discussion, use the "+" button or right-click the list.',
        shared: 'Shared discussion',
        draft: 'Has an unsent draft',
        newWindow: 'Open in a new window',
        nothing: 'Nothing found',
        resize: 'Width of the discussion list'
    },
    deleteDiscussion: {
        title: (name) => `Delete the discussion "${name}"?`,
        local: 'The discussion, all its branches, drafts and read marks are deleted from this computer. You cannot undo this. To keep a copy, export the discussion to a file first (File > Export…).',
        shared: 'You leave the shared discussion: the sync stops, and the discussion is deleted from this computer. The other members keep it. Your files in the shared folder stay. To come back, you need a new invitation.',
        confirm: 'Delete',
        cancel: 'Cancel'
    },
    stats: {
        label: 'Discussion statistics',
        messages: (n) => `Messages: ${n}`,
        open: (n) => `in open branches: ${n}`,
        closed: (n) => `in closed: ${n}`,
        read: (n) => `Read: ${n}`,
        unread: (n) => `unread: ${n}`,
        delivered: (n) => `Delivered: ${n}`,
        waiting: (n) => `waiting: ${n}`,
        loading: (n) => `loading: ${n}`,
        text: (size) => `Text: ${size}`,
        files: (size) => `Files: ${size}`
    },
    newDiscussion: {
        title: 'New discussion',
        label: 'Name',
        defaultTitle: 'New discussion',
        confirm: 'Create',
        cancel: 'Cancel'
    },
    nameDialog: {
        title: 'What is your name?',
        explanation: 'This name is shown next to your messages. You can change it later.',
        label: 'Your name',
        confirm: 'Continue',
        cancel: 'Cancel'
    },
    discussion: {
        windowTitle: (fileName, unread = 0) =>
            unread > 0 ? `(${unread}) ${fileName} — BranchChat` : `${fileName} — BranchChat`,
        empty: 'No messages yet. Write the first one.',
        saved: 'Saved',
        saving: 'Saving…',
        saveFailed: (reason) => `Could not save: ${reason}`,
        retry: 'Try again',
        dismiss: 'Hide'
    },
    composer: {
        placeholder: 'Write a message…',
        send: 'Send',
        hint: 'send',
        ariaLabel: 'Message text',
        cannotSend: 'The message could not be prepared for sending.'
    },
    editor: {
        toolbar: 'Formatting',
        heading: (level) => `Heading ${level}`,
        bold: 'Bold',
        italic: 'Italic',
        underline: 'Underline',
        bulletList: 'Bulleted list',
        orderedList: 'Numbered list',
        indent: 'Increase indent',
        outdent: 'Decrease indent',
        textColor: 'Text color',
        backgroundColor: 'Background color',
        noColor: 'No color',
        link: 'Link',
        undo: 'Undo',
        redo: 'Redo',
        colorNames: {
            '#d32f2f': 'Red',
            '#ef6c00': 'Orange',
            '#2e7d32': 'Green',
            '#1565c0': 'Blue',
            '#6a1b9a': 'Purple',
            '#616161': 'Gray',
            '#fff59d': 'Yellow',
            '#c8e6c9': 'Light green',
            '#bbdefb': 'Light blue',
            '#f8bbd0': 'Pink',
            '#ffe0b2': 'Peach',
            '#e0e0e0': 'Light gray'
        }
    },
    images: {
        insert: 'Insert image…',
        uploading: 'Adding the image…',
        unavailable: 'Image not available',
        unavailableHint: 'The data of the image is missing in the file or damaged.',
        view: 'Open image',
        viewerTitle: 'Image',
        close: 'Close',
        pickTitle: 'Choose an image',
        pickFilter: 'Images',
        loading: 'The image is loading…',
        loadingProgress: (received, total) => `The image is loading… ${received} of ${total}`
    },
    shared: {
        newTitle: 'New shared discussion',
        convertTitle: 'Make the discussion shared',
        joinTitle: 'Join a discussion',
        inviteTitle: 'Invite a member',
        inviteIntro:
            'The new member opens “Join a discussion” and chooses the same shared folder; their key then shows here. You can also get the key as a file or as text. Compare the fingerprint by phone or in person. The new member gets the whole discussion, and the other members see them in the list.',
        inviteSend: 'Invite',
        reinviteTitle: 'Invite again',
        reinviteIntro: (name) =>
            `${name} lost the key (for example, after Windows was installed again) and made a new one. Ask them to open “Join a discussion” and to choose the same shared folder; the new key then shows here. Compare the new fingerprint by phone or in person. The other members must also compare and accept the new key.`,
        reinviteCurrent: 'Previous fingerprint',
        reinviteSend: 'Invite again',
        rejoinNote:
            'This is a new invitation after a lost key: the app gives you back your earlier member name in this discussion.',
        addedBy: (name) => `invited by: ${name}`,
        creator: 'created the discussion',
        autoStartNote:
            'After this, BranchChat starts with Windows and receives messages in the background (an icon in the notification area). You can turn this off: File > Settings.',
        intro: 'A shared discussion is synchronized through a shared folder, for example a Google Drive folder on the computer. Messages are encrypted: the storage service cannot read them. It sees only service data: who has access to the folder, and the sizes and times of the files.',
        keyStep: 'Your key',
        keyHint:
            'The private part of the key stays on this computer. If the key is lost (for example, after Windows is installed again), you must be invited again.',
        nameFirst: 'First enter your name (File > Settings…).',
        keysUnavailable:
            'The encryption key is not available: Windows data protection does not work. Shared discussions are not available on this computer.',
        folderStep: 'Shared folder',
        folderHint:
            'Make a folder in the sync program (for example, in Google Drive) and give the members access with the right to edit. In streaming mode, mark the folder “Available offline”. Then choose it on this computer.',
        chooseFolder: 'Choose folder…',
        folderOk: 'The folder is good: writing, reading, and deleting work.',
        folderFailed: (step) =>
            `This folder does not work (${step}). Check the access rights and that the sync program runs.`,
        membersStep: 'Members',
        membersHint:
            'Each member opens “Join a discussion” and chooses the same folder; their key then shows here. You can also get the key as a file or as text (through WhatsApp). Compare the fingerprint of each member by phone or in person.',
        refresh: 'Refresh the list',
        pasteLabel: 'Paste the key of a member (text BRANCHCHAT-KEY-1:…)',
        addPasted: 'Add',
        fromFile: 'Key from a file…',
        noCandidates: 'There are no keys of other members in the folder yet.',
        accept: 'Invite',
        discard: 'Reject',
        discarded: 'rejected',
        create: 'Create and invite',
        convert: 'Make shared and invite',
        rosterTitle: 'Members of the shared discussion',
        stateSelf: 'you',
        stateInvited: 'invited',
        stateJoined: 'joined',
        stateMember: 'member',
        joinWaiting:
            'Your key is in the shared folder. Ask the person who invites you to add you. The invitation shows here by itself.',
        joinIncomplete: (received, total) =>
            `The invitation is arriving: ${received} of ${total} parts…`,
        joinReady: (name) => `Invitation from ${name}`,
        joinCheck:
            'Compare the fingerprint of the key of the person who invites you with what they tell you. If the fingerprint is different, do not accept the invitation.',
        joinAccept: 'The fingerprint is the same: accept the invitation',
        joinAlready: 'This discussion is already on this computer.',
        close: 'Close',
        cancel: 'Cancel',
        defaultFileName: 'Shared discussion',
        titleLabel: 'Name of the discussion',
        folderSteps: {
            root: 'folder not found',
            write: 'writing',
            read: 'reading',
            delete: 'deleting'
        },
        folderTitle: 'Choose the shared folder',
        keyFileTitle: 'Choose the key file of the member'
    },
    delivery: {
        ariaLabel: 'Message state',
        pending: 'Sending',
        written: 'Written to the shared folder',
        delivered: 'Delivered to all',
        'read-some': 'Read by at least one',
        'read-all': 'Read by all',
        hint: {
            pending: 'The message is still being written to the shared folder.',
            written:
                'The message is in the shared folder, but not all members have it yet. Click to see each member.',
            delivered: 'All members have the message, but nobody has marked it as read yet.',
            'read-some': 'At least one member has read the message. Click to see each member.',
            'read-all': 'All members have read the message.'
        },
        member: {
            pending: 'not written yet',
            written: 'not received yet',
            delivered: 'received',
            read: 'read',
            unread: 'not read'
        }
    },
    syncStatus: {
        missing: (path) =>
            `The shared folder is not available: ${path}. Check that the sync program (for example, Google Drive) runs and that the folder is visible on this computer.`,
        noPermission:
            'No right to write to the shared folder. Ask the owner of the folder to check the access.',
        quarantined: (n) =>
            `Files in the shared folder that could not be used: ${n}. They are damaged, too large, or not from members of the discussion.`,
        needsUpdate:
            'Changes arrived that need a newer version of the app (for example, a change of the keys of a member). Update the app.',
        check: 'Check folders',
        checking: 'Checking…',
        lastScan: (time) => `Last check: ${time}`,
        keysChanged: (name) =>
            `The keys of ${name} changed. Compare the fingerprint with this person (by phone or in person).`,
        keysRejected: (name) =>
            `You rejected the new keys of ${name}. You do not get their messages, and they do not get yours.`,
        keysAccept: 'The fingerprint is the same: accept',
        keysReject: 'Reject',
        keysAcceptLater: 'Accept after all',
        notAccepted: (names) =>
            `These members have not accepted your new keys yet: ${names}. Messages between you are not delivered yet. Ask them to compare the fingerprint.`,
        waiting: (name, since, files) =>
            `No activity from ${name} since ${since}. Your files for this member in the shared folder: ${files}.`,
        dropFiles: (name) => `Delete my files for ${name}…`,
        dropTitle: (name) => `Delete your files for ${name}?`,
        dropText: (name) =>
            `Your files for ${name} that were not received yet (messages and receipts) are deleted from the shared folder. ${name} does not get these messages. The discussion does not change for you. The files of this member in your folder stay: only the member who wrote a file deletes it.`,
        dropConfirm: 'Delete',
        dropCancel: 'Cancel'
    },
    loadingMessage: {
        progress: (parts, total, mb, totalMb) =>
            `Loading: ${parts} of ${total} parts (${mb} of ${totalMb} MB)`,
        hint: 'The message is still arriving from the shared folder. You can mark it as read or reply to it when it has arrived completely.',
        noText: 'The text has not arrived yet'
    },
    linkDialog: {
        title: 'Link',
        label: 'Link text',
        url: 'Address',
        apply: 'Apply',
        remove: 'Remove link',
        cancel: 'Cancel',
        invalidUrl: 'Only http, https, and e-mail (mailto) addresses are allowed.'
    },
    unread: {
        label: 'New',
        markRead: 'Mark as read',
        markThread: 'Mark the messages of this branch as read',
        markAll: 'Mark all as read',
        total: (n) => `Unread: ${n}`,
        inThread: (n) => `Unread here: ${n}`,
        descendantsHint: 'There are unread messages in child branches',
        panelCount: (n) => `Unread: ${n}`
    },
    readStatus: {
        none: 'Nobody has read it yet',
        some: 'Not read by all',
        all: 'Read by all',
        readBy: 'Read by',
        notReadBy: 'Not read by',
        nobody: 'nobody',
        close: 'Close',
        ariaLabel: 'Who has read this message'
    },
    days: {
        today: 'Today',
        yesterday: 'Yesterday',
        jumpTitle: 'Go to date',
        jumpHint: 'The days with messages of this branch are marked.',
        previousMonth: 'Previous month',
        nextMonth: 'Next month',
        weekdays: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
        noMessages: 'This branch has no messages yet.',
        close: 'Close'
    },
    shortcuts: {
        title: 'Keyboard shortcuts',
        groups: {
            window: 'Window',
            messages: 'Messages',
            search: 'Search',
            editor: 'Text formatting',
            dialogs: 'Dialogs'
        },
        actions: {
            newDiscussion: 'New discussion',
            open: 'Import a discussion',
            settings: 'Settings',
            zoomIn: 'Larger',
            zoomOut: 'Smaller',
            zoomReset: 'Normal text size',
            shortcuts: 'This list',
            jumpToDate: 'Go to date',
            find: 'Find in discussion',
            findAll: 'Find in all discussions',
            findNext: 'Next result (in the search field)',
            findPrevious: 'Previous result (in the search field)',
            branchMap: 'Branch map',
            send: 'Send the message',
            newLine: 'New line in the message',
            pasteImage: 'Paste a picture',
            link: 'Link',
            bold: 'Bold',
            italic: 'Italic',
            underline: 'Underline',
            undo: 'Undo',
            redo: 'Redo',
            indent: 'Increase the indent in a list',
            outdent: 'Decrease the indent in a list',
            confirm: 'Confirm',
            close: 'Close a dialog or a menu'
        },
        wheel: 'Ctrl + mouse wheel: larger or smaller',
        close: 'Close'
    },
    report: {
        title: 'Report for support',
        fileName: (date) => `BranchChat-report-${date}.zip`,
        contents:
            'The report contains: the log of the app, the versions of the app and of Windows, the settings without your name, the sync state without keys.\n\nThe report has no message text, no discussion names, and no keys. File paths can contain the Windows user name and file names.',
        save: 'Save…',
        cancel: 'Cancel',
        saved: 'The report is saved. You can send it for support.'
    },
    notifications: {
        image: '[image]',
        title: (author, discussion) => `${author} — ${discussion}`,
        noText: 'New message',
        summary: (n) => `New messages: ${n}`
    },
    tray: {
        tooltip: 'BranchChat',
        open: 'Open',
        discussions: 'Shared discussions',
        noDiscussions: 'No shared discussions',
        checkFolders: 'Check folders',
        exit: 'Exit',
        status: {
            ok: 'Sync works',
            missing: (name) => `“${name}”: the shared folder is not available`,
            denied: (name) => `“${name}”: no right to write`,
            problem: (name) => `“${name}”: there are sync problems`,
            keys: (name) => `“${name}”: the keys of a member changed; check them`
        },
        noticeTitle: 'BranchChat keeps running',
        noticeText:
            'The window is closed, but BranchChat stays in the notification area and receives messages of shared discussions. To close the app completely, right-click the BranchChat icon and choose “Exit”.'
    },
    settings: {
        title: 'Settings',
        nameLabel: 'Your name',
        nameHint: 'The new name is shown in new messages. Earlier messages do not change.',
        saveName: 'Save name',
        startupHeading: 'Start and recent discussions',
        openLastFile: 'Open the last discussion at start',
        openLastFileHint:
            'When BranchChat starts without a file, it opens the discussion that you used last time.',
        recentLimitLabel: 'How many recent discussions the menu shows',
        recentLimitHint:
            'The list is in the “File” menu and on the taskbar icon. 0: do not show. The start screen shows all discussions.',
        nameSaved: 'The name is saved.',
        textSizeHeading: 'Text size',
        textSizeReset: 'Normal size',
        textSizeHint:
            'For all windows. Also Ctrl and plus, Ctrl and minus, Ctrl+0, or Ctrl and the mouse wheel.',
        backgroundHeading: 'Background work',
        notifyNew: 'Notifications of new messages',
        notifyNewHint:
            'Windows shows a notification when another member of a shared discussion writes a message. If the window of this discussion is open and active, there is no notification.',
        notifyText: 'Show the text in notifications',
        notifyTextHint:
            'If you turn this off, a notification shows only the author and the name of the discussion. Windows can keep notifications in the notification center.',
        startWithWindows: 'Start with Windows',
        startWithWindowsHint:
            'BranchChat starts without a window, in the notification area, and receives the messages of shared discussions.',
        languageHeading: 'Язык / Language',
        languageRu: 'Русский',
        languageEn: 'English',
        languageHint:
            'The language of the app. The text of messages is not translated. The new language applies after BranchChat restarts.',
        restartNow: 'Restart now',
        close: 'Close'
    },
    identity: {
        heading: 'Encryption key',
        explanation:
            'The key is necessary for shared discussions. The private part of the key is only on this computer, in your Windows account, and is never sent anywhere. Other members get only the public part.',
        fingerprintLabel: 'Key fingerprint',
        fingerprintHint:
            'Compare the fingerprint with the other member by phone or in person: then you know that the key is theirs.',
        copy: 'Copy my key',
        copied: 'The key is copied. You can paste it into a message.',
        save: 'Save my key…',
        saved: 'The key file is saved.',
        nameFirst: 'To give your key to others, first enter your name.',
        unavailable:
            'The encryption key is not available: Windows data protection does not work for your account. Shared discussions are not available on this computer.',
        replacedUnreadable:
            'The previous key could not be read (for example, after the Windows profile was moved). A new key with a new fingerprint was made.',
        replacedOther:
            'The previous key belonged to another member (the settings were made again). A new key with a new fingerprint was made.',
        loading: 'Loading…',
        sizeLimitLabel: 'Largest file in the shared folder, MB',
        sizeLimitHint:
            'The app does not read files of the shared folder that are larger than this (protection against files of others). 5 to 1000 MB, default 30. Large pictures travel in parts of 4 MB, so this does not apply to them. You get attachments larger than this only after you raise the limit. The other members learn your limit.',
        saveTitle: 'Save key',
        fileFilter: 'BranchChat key'
    },
    association: {
        heading: 'Discussion files',
        checkbox: 'Open .branchchat files in BranchChat',
        explanation:
            'A double-click on a .branchchat file in Explorer opens it in BranchChat. This applies only to your Windows account, and you can undo it at any time.',
        stateOn: 'On: .branchchat files open in BranchChat.',
        stateOff: 'Off.',
        stateOther:
            '.branchchat files belong to another program. BranchChat does not change this itself; you can change it in the Windows settings (“Default apps”).',
        stateUnsupported:
            'Not available: the file association can be set only in the installed version of BranchChat for Windows.',
        askTitle: 'Open .branchchat files in BranchChat?',
        askText:
            'Then a double-click on a discussion file in Explorer opens it in BranchChat. This applies only to your Windows account, and you can change it in Settings (File > Settings).',
        askYes: 'Yes, open them',
        askNo: 'No'
    },
    fileType: {
        name: 'BranchChat discussion'
    },
    update: {
        title: 'BranchChat update',
        checking: 'Checking for updates…',
        upToDate: (version) => `The latest version is installed (${version}).`,
        available: (version) => `Version ${version} is available`,
        current: (version) => `Installed now: version ${version}.`,
        releaseDate: 'Release date',
        size: 'Download size',
        notes: 'What is new',
        noNotes: 'No description was published.',
        download: 'Download',
        downloading: 'Downloading…',
        ready: 'The update is downloaded.',
        readyHint:
            'It is installed when BranchChat restarts. Your discussions and settings do not change.',
        installNow: 'Restart and install',
        later: 'Later',
        openPage: 'Release page',
        close: 'Close',
        retry: 'Try again',
        banner: (version) => `BranchChat update ${version} is available.`,
        bannerDetails: 'Details',
        bannerDismiss: 'Hide'
    },
    updateSettings: {
        heading: 'Updates',
        autoCheck: 'Check for updates automatically',
        hint: 'The check goes only to GitHub and sends no discussions, names, or messages. An update is installed only after you agree.',
        checkNow: 'Check now'
    },
    readNotice: {
        title: 'Others can see your read marks',
        text: 'The messages that you have read are saved in the discussion file. Everybody who has this file sees your read marks. This is shown once.',
        confirm: 'I understand',
        cancel: 'Cancel'
    },
    branches: {
        panelTitle: 'Branches',
        mainThread: 'Main discussion',
        active: 'Active',
        closed: 'Closed',
        noBranches: 'No branches yet. Select text in a message and click “Reply to this”.',
        replyToThis: 'Reply to this',
        replyHint: 'Make a branch from the selected text',
        pathLabel: 'Path',
        titleLabel: 'Branch title',
        titlePlaceholder: 'Title (optional)',
        close: 'Close branch',
        reopen: 'Open the branch again',
        goToSource: 'To the source message',
        quoteLabel: 'Quote',
        contextDivider: 'Replies in this branch',
        contextCaption: 'Earlier messages (read only)',
        closedNotice: 'This branch is closed. Open it again to write in it.',
        belongsTo: (label) => `from branch “${label}”`,
        branchCount: (n) => `${n} ${plural(n, 'branch', 'branches')}`,
        openBranch: (label) => `Open branch “${label}”`,
        messageCount: (n) => String(n)
    },
    message: {
        linkTitle: (href) => `Open: ${href}`
    },
    notices: {
        twoCopies: (otherPath, thisPath) =>
            `The same discussion is already open from another file. The file opened before: ${otherPath}. This file: ${thisPath}. The copies are not merged.`,
        detached:
            'This is a separate copy of a shared discussion. Changes in it are not sent to anybody and do not go into the shared discussion.',
        merged: (file, added) =>
            added > 0
                ? `The file “${file}” is merged with this discussion. New messages: ${added}.`
                : `The file “${file}” is merged with this discussion. No new messages; marks or branch titles are updated.`,
        nothingNew: (file) =>
            `The file “${file}” has nothing new: everything is already in this discussion.`
    },
    menu: {
        file: 'File',
        newDiscussion: 'New discussion',
        open: 'Import…',
        closeWindow: 'Close window',
        exit: 'Exit',
        edit: 'Edit',
        undo: 'Undo',
        redo: 'Redo',
        cut: 'Cut',
        copy: 'Copy',
        paste: 'Paste',
        selectAll: 'Select all',
        settings: 'Settings…',
        help: 'Help',
        checkUpdates: 'Check for updates…',
        about: 'About',
        newShared: 'New shared discussion…',
        joinShared: 'Join a discussion…',
        makeShared: 'Make the discussion shared…',
        inviteMember: 'Invite a member…',
        saveReport: 'Save report…',
        view: 'View',
        zoomIn: 'Larger',
        zoomOut: 'Smaller',
        zoomReset: 'Normal size',
        shortcuts: 'Keyboard shortcuts',
        jumpToDate: 'Go to date…',
        find: 'Find in discussion…',
        findAll: 'Find in all discussions…',
        branchMap: 'Branch map…',
        exportDiscussion: 'Export…',
        backupNow: 'Back up now',
        restore: 'Restore from backup…'
    },
    contextMenu: {
        noSuggestions: 'No suggestions',
        addToDictionary: 'Add to dictionary'
    },
    dialogs: {
        saveTitle: 'New discussion',
        openTitle: 'Import a discussion',
        fileFilter: 'BranchChat discussions',
        defaultFileName: 'New discussion',
        openFailedTitle: 'Could not open the discussion',
        createFailedTitle: 'Could not create the discussion',
        closeTitle: 'Close the discussion?',
        closeUnsentDraft: 'The message field has an unsent message. It will be lost.',
        closeSaveFailed:
            'The last changes could not be saved. If you close the window, they will be lost.',
        closeConfirm: 'Close',
        closeCancel: 'Cancel',
        nameRequired: 'First enter your name.',
        switchBlockedTitle: 'Changes not saved',
        switchBlocked:
            'The last changes of this discussion could not be saved. Click “Try again” in the window, then open another discussion.',
        exportTitle: 'Export the discussion',
        exportDefaultName: (name) => `${name}.branchchat`,
        exportHint:
            'The file is not synchronized and has no member list. You can send it as a normal discussion file or keep it as a copy.',
        exportFailedTitle: 'Could not export the discussion'
    },
    reactions: {
        add: 'Add a reaction',
        picker: 'Reactions',
        names: (names) => names.join(', '),
        count: (emoji, n, names) => `${emoji} ${n}: ${names.join(', ')}`,
        toggle: (emoji, mine) => (mine ? `Remove the reaction ${emoji}` : `React with ${emoji}`)
    },
    attachments: {
        attach: 'Attach file…',
        pickTitle: 'Choose files',
        remove: (name) => `Remove “${name}”`,
        save: 'Save as…',
        open: 'Open',
        saveTitle: 'Save attachment',
        list: 'Attachments',
        size: (bytes) => formatBytes(bytes),
        adding: 'Adding files…',
        tooLarge: (names, limitMb) =>
            `This file is larger than the limit of ${limitMb} MB and was not added: ${names}. You can change the limit: File > Settings > “Largest attachment”.`,
        unreadable: (names) => `Could not read the file: ${names}.`,
        tooMany: (max) => `One message can have at most ${max} files.`,
        defaultName: 'file',
        missing: 'File missing',
        missingHint: 'The data of this file is not in the library.',
        loading: 'The file is loading…',
        tooLargeForYou: (mb) => `The file is too large for your settings (${mb} MB)`,
        changeLimit: 'Change the limit',
        warnTitle: 'Open the file?',
        warnMessage: (name, ext) =>
            `“${name}” is a .${ext} file. Files of this type can start programs on the computer.`,
        warnDetail: (author) =>
            `Sent by: ${author}. Open it only if you trust this person and expected this file. Windows checks it as a file from the internet.`,
        warnOpen: 'Open',
        warnCancel: 'Cancel',
        smallLimitsTitle: 'Not everybody gets the file',
        smallLimits: (names, mb) => `${names} will not get this file: their limit is ${mb} MB.`,
        joinNames: (names) =>
            names.length <= 1
                ? names.join('')
                : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`,
        smallLimitsOne: (name, mb) => `${name} will not get this file: the limit is ${mb} MB.`,
        smallLimitsHint:
            'A member gets the file if they raise “Largest file in the shared folder” in their settings within 30 days.',
        sendAnyway: 'Send anyway',
        cancel: 'Cancel',
        limitLabel: 'Largest attachment, MB',
        limitHint:
            'Files larger than this cannot be attached to a message. 1 to 1000 MB, default 100. Images go into the text and do not depend on this limit.',
        heading: 'Attachments'
    },
    errors: {
        NOT_FOUND: 'File not found.',
        ACCESS_DENIED:
            'No access to the file. Maybe it is open in another program or protected against writing.',
        NOT_AN_ARCHIVE: 'The file is damaged or is not a BranchChat discussion.',
        UNSAFE_ENTRY: 'The file contains unsafe data and is not opened.',
        DUPLICATE_ENTRY: 'The file is damaged: it has repeated entries.',
        MISSING_ENTRY: 'The file is damaged: data is missing.',
        INVALID_JSON: 'The file is damaged: the discussion data cannot be read.',
        INVALID_SCHEMA: 'The file does not match the BranchChat format.',
        INVALID_STRUCTURE: 'The file is damaged: the discussion data does not agree.',
        UNSUPPORTED_VERSION:
            'The discussion was made by a newer version of BranchChat. Update the app to open it.',
        UNSUPPORTED_IMAGE: 'Only PNG, JPEG, GIF, and WebP images are supported.',
        ASSET_MISMATCH: 'An image in the file is damaged.',
        WRITE_FAILED: 'Could not write the file.',
        SAVE_FAILED: 'Could not save the changes in the discussion library.',
        CONFLICT: 'The discussion changed elsewhere. Close it and open it again.',
        SYNCED_IMPORT:
            'This is a shared discussion. A file cannot be merged with it: new messages of a shared discussion come through the shared folder.',
        NEWER_LIBRARY:
            'The discussion library was made by a newer version of BranchChat. Update the app.',
        TITLE_REQUIRED: 'Enter the name of the discussion.',
        DISCUSSION_OPEN: 'First close the window of this discussion.',
        NAME_REQUIRED: 'First enter your name.',
        OWN_KEY: 'This is your own key.',
        INVALID_KEY: 'This is not a BranchChat key, or the key is damaged.',
        NO_MEMBERS: 'Invite at least one member.',
        FILE_IN_SHARED_FOLDER:
            'A discussion file cannot be kept in the shared folder: there it would not be encrypted. Choose another place.',
        FOLDER_TEST_FAILED: 'The shared folder does not work. Check the access rights.',
        FOLDER_IN_USE:
            'This shared folder already has another discussion. Each shared discussion needs its own folder.',
        INVITATION_GONE:
            'The invitation is no longer available. Check the shared folder and try again.',
        NOT_SHARED: 'This is possible only in a shared discussion.',
        ALREADY_MEMBER: 'This person is already a member of the discussion.',
        NOT_MEMBER: 'This person is not a member of the discussion.',
        SAME_KEY:
            'The member already has this key. A new key is necessary: the one that was made after the previous one was lost.',
        KEYS_UNAVAILABLE:
            'The encryption key is not available: Windows data protection does not work for your account.',
        IMAGE_READ_FAILED: 'Could not read the image file.',
        UPDATE_NOT_SUPPORTED:
            'The update check is available only in the installed version of BranchChat.',
        UPDATE_CHECK_FAILED:
            'Could not check for updates. Check the internet connection and try again later. Your discussions are not affected.',
        UPDATE_DOWNLOAD_FAILED:
            'Could not download the update. The current version keeps working; try again later.',
        UPDATE_VERIFY_FAILED:
            'The downloaded file did not pass the integrity check and is not installed. The current version keeps working.',
        ASSOCIATION_BLOCKED:
            '.branchchat files already belong to another program. BranchChat does not change this Windows setting. You can change it in the Windows settings (“Default apps”).',
        ASSOCIATION_FAILED: 'Could not change the association of .branchchat files.',
        ASSOCIATION_UNSUPPORTED:
            'The file association is available only in the installed version of BranchChat for Windows.',
        READ_NOTICE_REQUIRED: 'First confirm the notice about read marks.',
        THREAD_CLOSED: 'The branch is closed. Open it to write in it.',
        INVALID_SELECTION: 'The selected text could not be found. Select the text again.',
        EMPTY_QUOTE: 'Select the text to make a branch from.',
        THREAD_NOT_FOUND: 'Branch not found.',
        MESSAGE_NOT_FOUND: 'Message not found.',
        INVALID_REACTION: 'There is no such reaction.',
        TOO_MANY_ATTACHMENTS: 'Too many files in one message.',
        ATTACHMENT_NOT_FOUND: 'Attachment not found.',
        ATTACHMENT_MISSING: 'The data of this file is not on this computer.',
        ATTACHMENT_SAVE_FAILED: 'Could not save the file.',
        ATTACHMENT_OPEN_FAILED: 'Could not open the file.',
        EMPTY_MESSAGE: 'The message is empty: write a text or attach a file.',
        UNKNOWN_ASSET: 'The image or file was not found. Add it again.',
        MAIN_THREAD_NOT_CLOSABLE: 'The main discussion cannot be closed.',
        FORBIDDEN: 'This action is not available.',
        INVALID_REQUEST: 'Invalid request. Try again.',
        EXISTS: 'This discussion is already in the library.',
        DAMAGED: 'The discussion library is damaged.',
        NO_DOCUMENT: 'No discussion is open.',
        UNKNOWN: 'An unexpected error occurred.'
    }
}
