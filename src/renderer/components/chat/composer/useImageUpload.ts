import type { Editor } from '@tiptap/core'
import { useCallback, useRef, useState } from 'react'
import { useApi } from '../../../api'

/** Pictures in the draft (FR-065, FR-067): the main process checks the type and keeps them until a message is sent. */
export function useImageUpload({
    editor,
    setError
}: {
    editor: Editor | null
    setError(error: string | null): void
}): {
    uploading: boolean
    isUploading(): boolean
    /** Adds pictures at `at` (a drop), or at the cursor. */
    addImages(files: File[], at?: number): Promise<void>
    /** "Insert image…": the person chooses a file. */
    pickImage(): Promise<void>
} {
    const api = useApi()
    const [uploading, setUploading] = useState(0)
    const uploadingRef = useRef(0)
    const count = useCallback((delta: number) => {
        uploadingRef.current += delta
        setUploading(uploadingRef.current)
    }, [])

    const addImages = useCallback(
        async (files: File[], at?: number): Promise<void> => {
            if (!editor) return
            count(files.length)
            let position = at
            try {
                for (const file of files) {
                    const result = await api.stageImage(new Uint8Array(await file.arrayBuffer()))
                    if (!result.ok) {
                        setError(result.error.message)
                        continue
                    }
                    setError(null)
                    const image = { type: 'image', attrs: { assetId: result.data.assetId } }
                    const chain = editor.chain().focus()
                    if (position === undefined) chain.insertContent(image).run()
                    else {
                        chain.insertContentAt(position, image).run()
                        position += 1
                    }
                }
            } finally {
                count(-files.length)
            }
        },
        [api, editor, count, setError]
    )

    const pickImage = useCallback(async (): Promise<void> => {
        if (!editor) return
        count(1)
        try {
            const result = await api.pickImage()
            if (!result.ok) return setError(result.error.message)
            if (!result.data) return // cancelled
            setError(null)
            editor
                .chain()
                .focus()
                .insertContent({ type: 'image', attrs: { assetId: result.data.assetId } })
                .run()
        } finally {
            count(-1)
        }
    }, [api, editor, count, setError])

    return {
        uploading: uploading > 0,
        isUploading: () => uploadingRef.current > 0,
        addImages,
        pickImage
    }
}
