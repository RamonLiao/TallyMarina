import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';

export default function Landing() {
  const navigate = useNavigate();
  return (
    <main className="landing">
      <h1>Turn on-chain chaos into an audit-ready close.</h1>
      <Button variant="primary" onClick={() => navigate('/app')}>
        Launch App
      </Button>
    </main>
  );
}
