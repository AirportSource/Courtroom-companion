import { useEffect, useRef, useState, type FormEvent } from 'react'

interface ChatBarProps {
  placeholder: string
  disabled: boolean
  waiting: boolean
  waitingLabel: string
  error: string | null
  onSubmit: (message: string) => void
}

const MAX_MESSAGE = 2000

/** Minimal message input under the scene. Focuses itself whenever it becomes available. */
export function ChatBar({ placeholder, disabled, waiting, waitingLabel, error, onSubmit }: ChatBarProps) {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

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
