import { createContext, useContext } from 'react'

/** Opens and closes the Messenger panel; provided by the app layout. */
export type MessengerControls = {
  /** Open the panel: on the chat with this address, or on the list of people. */
  open: (email?: string) => void
  close: () => void
}

// Outside the layout (a page rendered on its own) the controls do nothing.
export const MessengerContext = createContext<MessengerControls>({
  open: () => undefined,
  close: () => undefined,
})

export const useMessenger = () => useContext(MessengerContext)
