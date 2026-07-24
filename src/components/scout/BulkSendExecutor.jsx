import { Send } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { BRAND } from '../../theme/tokens';

export default function BulkSendExecutor({ payload }) {
  const T = useT();

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '40px 20px', textAlign: 'center',
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: '50%',
        background: `${BRAND.cyan}15`, display: 'flex',
        alignItems: 'center', justifyContent: 'center', marginBottom: 16,
      }}>
        <Send size={24} style={{ color: BRAND.cyan }} />
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 8 }}>
        Ready to Send
      </div>
      <div style={{ fontSize: 13, color: T.textMuted, maxWidth: 380, lineHeight: 1.5 }}>
        BulkSendExecutor will handle sending {payload?.length || 0} email{payload?.length !== 1 ? 's' : ''} here.
        This component will be wired in when Workstream C is complete.
      </div>
      <div style={{
        marginTop: 20, padding: '10px 16px', borderRadius: 8,
        background: T.surface, border: `1px solid ${T.border}`,
        fontSize: 12, color: T.textFaint,
      }}>
        Payload: {payload?.length || 0} contacts with subject and personalized body ready
        {payload?.some(p => p.attachment) && ' + PDF attachment'}
        {payload?.some(p => p.cc) && ' + CC'}
      </div>
    </div>
  );
}
