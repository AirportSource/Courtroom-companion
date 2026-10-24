import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { audioEngine } from '../engine/audioEngine.ts'
import { createTypingBlipper, type TypingBlipConfig } from '../engine/typingBlips.ts'

interface ChatBarProps {
  placeholder: string
  disabled: boolean
  waiting: boolean
  waitingLabel: string
  error: string | null
  onSubmit: (message: string) => void
  /** Optional blip while the player types (volume/mute come from the blip settings). */
  typingBlip?: TypingBlipConfig
}

const MAX_MESSAGE = 2000

/** Minimal message input under the scene. Focuses itself whenever it becomes available. */
export function ChatBar({ placeholder, disabled, waiting, waitingLabel, error, onSubmit, typingBlip }: ChatBarProps) {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const blipper = useMemo(() => createTypingBlipper((volume) => audioEngine.playEvent('user_typing', volume)), [])

  useEffect(() => {
    if (!disabled) inputRef.current?.focus()
  }, [disabled])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const message = text.trim()
    if (!message || disabled) return
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
      <button className="chat-send" type="submit" disabled={disabled || !text.trim()}>
        Send
      </button>
      {error && (
        <p className="chat-error" role="alert">
          Couldn&apos;t get a reply: {error}
        </p>
      )}
    </form>
  )
}
