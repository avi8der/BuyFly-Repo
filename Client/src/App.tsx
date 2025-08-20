// Client/src/App.tsx
import { useState } from 'react';

export default function App() {
  const [count, setCount] = useState(0);
  return (
    <div style={{ fontFamily: 'system-ui', padding: 16 }}>
      <h1>BuyFly 🦉</h1>
      <p>Build check — Client is compiling without Radix UI.</p>
      <button onClick={() => setCount((c) => c + 1)} style={{ padding: '8px 12px', borderRadius: 8 }}>
        Clicks: {count}
      </button>
    </div>
  );
}
