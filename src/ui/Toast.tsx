interface ToastProps {
  text: string
}

/** A single, non-blocking status message. Container pointer-events stay off in the parent layer. */
export default function Toast({ text }: ToastProps) {
  return (
    <div className="toast" role="status">
      {text}
    </div>
  )
}
