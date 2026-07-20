import { Search, Zap } from 'lucide-react';
import { motion } from 'framer-motion';

interface Props {
  icon: 'search' | 'shortcut';
  title: string;
  description: string;
}

export default function EmptyState({ icon, title, description }: Props) {
  const Icon = icon === 'search' ? Search : Zap;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center py-16 gap-4"
    >
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center"
        style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}
      >
        <Icon size={28} style={{ color: 'var(--color-text-muted)' }} />
      </div>
      <div className="text-center">
        <h3 className="text-base font-medium mb-1" style={{ color: 'var(--color-text)' }}>{title}</h3>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{description}</p>
      </div>
    </motion.div>
  );
}
