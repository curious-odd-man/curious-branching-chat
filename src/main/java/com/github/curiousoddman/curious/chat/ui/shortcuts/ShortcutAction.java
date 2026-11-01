package com.github.curiousoddman.curious.chat.ui.shortcuts;

import javafx.scene.input.KeyCode;
import lombok.Getter;
import lombok.RequiredArgsConstructor;

import static com.github.curiousoddman.curious.chat.ui.shortcuts.ShortcutCategory.ACTION;
import static com.github.curiousoddman.curious.chat.ui.shortcuts.ShortcutCategory.TOOL;

@Getter
@RequiredArgsConstructor
public enum ShortcutAction {

    TOOL_SELECT(TOOL, ShortcutKey.of(KeyCode.SPACE)),
    TOOL_MOVE(TOOL, ShortcutKey.of(KeyCode.M)),
    TOOL_MOVE_SMART(TOOL, ShortcutKey.shift(KeyCode.M)),
    TOOL_ROTATE(TOOL, ShortcutKey.of(KeyCode.R)),
    TOOL_PUSHPULL(TOOL, ShortcutKey.of(KeyCode.P)),
    TOOL_RULER(TOOL, ShortcutKey.of(KeyCode.T)),
    TOOL_DIMENSIONS(TOOL, ShortcutKey.of(KeyCode.D)),

    ACTION_PART_ADD(ACTION, ShortcutKey.ctrl(KeyCode.A)),
    ACTION_MILLING_ADD(ACTION, ShortcutKey.ctrl(KeyCode.M)),
    ACTINO_IMPORT(ACTION, ShortcutKey.ctrl(KeyCode.I)),
    ACTION_SAVE(ACTION, ShortcutKey.ctrl(KeyCode.S)),
    ACTION_COPY_HOVER_INFO(ACTION, ShortcutKey.ctrl(KeyCode.C)),
    ACTION_DUPLICATE_SELECTION(ACTION, ShortcutKey.ctrl(KeyCode.D)),
    ACTION_CREATE_GROUP(ACTION, ShortcutKey.ctrl(KeyCode.G)),
    ACTION_CREATE_COMPONENT(ACTION, ShortcutKey.ctrl(KeyCode.N)),
    ACTION_UNDO(ACTION, ShortcutKey.ctrl(KeyCode.Z)),
    ACTION_REDO(ACTION, ShortcutKey.ctrl(KeyCode.Y)),
    ACTION_HISTORY_TOGGLE(ACTION, ShortcutKey.ctrl(KeyCode.H));

    private final ShortcutCategory category;
    private final ShortcutKey      defaultCombination;
}
