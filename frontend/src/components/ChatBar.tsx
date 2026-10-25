import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { audioEngine } from '../engine/audioEngine.ts'
import { createTypingBlipper, type TypingBlipConfig } from '../engine/typingBlips.ts'
import { useT } from '../i18n/useT.ts'

interface ChatBarProps {
  placeholder: string
  disabled: boolean
  waiting: boolean
  waitingLabel: string
  onSubmit: (message: string) => void
  /** Optional blip while the player types (volume/mute come from the blip settings). */
  typingBlip?: TypingBlipConfig
  /** Allow sending an empty message (e.g. evidence presented without a question). */
  allowEmpty?: boolean
  /** Submit button text (default "Send"). */
  submitLabel?: string
}

const MAX_MESSAGE = 2000

/** Minimal message input under the scene. Focuses itself whenever it becomes available. */
export function ChatBar({ placeholder, disabled, waiting, waitingLabel, onSubmit, typingBlip, allowEmpty = false,
  submitLabel }: ChatBarProps) {
  const t = useT()
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const blipper = useMemo(() => createTypingBlipper((volume) => audioEngine.playEvent('user_typing', volume)), [])

  useEffect(() => {
    if (!disabled) inputRef.current?.focus()
  }, [disabled])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const message = text.trim()
    if ((!message && !allowEmpty) || disabled) return
    setText('')
    onSubmit(message)
  }

  return (
    <form className="chat-bar" onSubmit={submit}>
      <input
        ref={inputRef}
        className="chat-input"
        value={text}
        maxLength={MAX_MESSAGE}
        placeholder={waiting ? waitingLabel : placeholder}
        disabled={disabled}
        onChange={(event) => setText(event.target.value)}
        onInput={(event) => {
          const native = event.nativeEvent as InputEvent
          if (typingBlip) blipper.onInput({ inputType: native.inputType, data: native.data, isComposing: native.isComposing }, typingBlip)
        }}
        onCompositionEnd={(event) => {
          if (typingBlip) blipper.onCompositionEnd(event.data, typingBlip)
        }}
        aria-label={placeholder}
      />
      <button className="chat-send" type="submit" disabled={disabled || (!allowEmpty && !text.trim())}>
        {submitLabel ?? t('chat.send')}
      </button>
    </form>
  )
}
