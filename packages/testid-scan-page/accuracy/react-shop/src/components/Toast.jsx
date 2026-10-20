import { useState } from 'react';

export default function Toast() {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;
  return (
    <div role="status">
      Saved.
      <button data-gt="toast-close" onClick={() => setVisible(false)}>Close</button>
    </div>
  );
}
