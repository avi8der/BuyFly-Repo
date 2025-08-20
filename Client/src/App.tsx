// Client/src/App.tsx
import { useState } from 'react';

export default function App() {
  const [clicked, setClicked] = useState(false);

  return (
    <div style={{ fontFamily: 'system-ui', padding: 20 }}>
      <h1>BuyFly 🦉</h1>
      <p>CI test build — no Radix imports here.</p>
      <button
        onClick={() => setClicked(true)}
        style={{ padding: '10px 16px', borderRadius: 8, cursor: 'pointer' }}
      >
        Test Button
      </button>
      {clicked && <p>✅ Button works!</p>}
    </div>
  );
}
