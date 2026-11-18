import { useCallback, useRef, useState } from 'react'
import type { AttachResult } from '@shared/types/ipc'
import { MAX_ATTACHMENTS_PER_MESSAGE, type Attachment } from '@shared/validation'
import { useApi } from '../../../api'
import { refusedText } from './content'

/**
 * FR-261: the files of the draft. Files (dropped, pasted, or chosen) are stored by the main process and listed in the
 * draft; `onChange` gets each new list that the person made.
 */
export function useAttachments({
    setError,
    onChange
}: {
    setError(error: string | null): void
    onChange(files: Attachment[]): void
}): {
    files: Attachment[]
    /** The files now, also inside callbacks that were made before the last render. */
    current(): Attachment[]
    /** Puts a list in place (another branch, a restored draft, a sent message); `onChange` is not called. */
    replace(files: Attachment[]): void
    /** True while files are being added. */
    attaching: boolean
    isAttaching(): boolean
    addFiles(list: File[]): Promise<void>
    pickFiles(): Promise<void>
    removeFile(index: number): void
} {
    const api = useApi()
    const [files, setFiles] = useState<Attachment[]>([])
    const filesRef = useRef<Attachment[]>([])
    const [attaching, setAttaching] = useState(0)
    const attachingRef = useRef(0)
    const onChangeRef = useRef(onChange)
    onChangeRef.current = onChange

    const replace = useCallback((next: Attachment[]) => {
        filesRef.current = next
        setFiles(next)
    }, [])
    const change = useCallback(
        (next: Attachment[]) => {
            replace(next)
            onChangeRef.current(next)
        },
        [replace]
    )
    const busy = useCallback(async (work: () => Promise<void>): Promise<void> => {
        attachingRef.current += 1
        setAttaching(attachingRef.current)
        try {
            await work()
        } finally {
            attachingRef.current -= 1
            setAttaching(attachingRef.current)
        }
    }, [])
    const take = useCallback(
        (r: AttachResult): void => {
            setError(refusedText(r))
            if (r.added.length === 0) return
            change([...filesRef.current, ...r.added].slice(0, MAX_ATTACHMENTS_PER_MESSAGE))
        },
        [change, setError]
    )

    const addFiles = useCallback(
        (list: File[]) =>
            busy(async () => {
                const paths: string[] = []
                for (const file of list) {
                    const path = api.getPathForFile(file)
                    if (path) paths.push(path)
                    else {
                        const r = await api.addAttachmentBytes(
                            file.name,
                            file.type,
                            new Uint8Array(await file.arrayBuffer())
                        )
                        if (r.ok) take(r.data)
                        else setError(r.error.message)
                    }
                }
                if (paths.length > 0) {
                    const r = await api.addAttachmentPaths(paths)
                    if (r.ok) take(r.data)
                    else setError(r.error.message)
                }
            }),
        [api, busy, take, setError]
    )
    const pickFiles = useCallback(
        () =>
            busy(async () => {
                const r = await api.pickAttachments()
                if (r.ok) take(r.data)
                else setError(r.error.message)
            }),
        [api, busy, take, setError]
    )
    const removeFile = useCallback(
        (index: number) => change(filesRef.current.filter((_, i) => i !== index)),
        [change]
    )

    return {
        files,
        current: () => filesRef.current,
        replace,
        attaching: attaching > 0,
        isAttaching: () => attachingRef.current > 0,
        addFiles,
        pickFiles,
        removeFile
    }
}
