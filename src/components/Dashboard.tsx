import React, { useState } from 'react';
import { User } from './AuthSystem';
import { AdminDashboard } from './dashboards/AdminDashboard';
import { VolunteerDashboard } from './dashboards/VolunteerDashboard';
import { VictimDashboard } from './dashboards/VictimDashboard';
import { Header } from './Header';
import { Chatbot } from './Chatbot';
import { EmergencySOSForm } from './EmergencySOSForm';
import { Dialog, DialogContent } from './ui/dialog';

interface DashboardProps {
  user: User;
  onLogout: () => void;
}

export function Dashboard({ user, onLogout }: DashboardProps) {
  const [activeView, setActiveView] = useState('dashboard');
  const [showSOS, setShowSOS] = useState(false);

  const renderDashboard = () => {
    switch (user.role) {
      case 'admin':
        return <AdminDashboard user={user} activeView={activeView} setActiveView={setActiveView} />;
      case 'volunteer':
        return <VolunteerDashboard user={user} activeView={activeView} setActiveView={setActiveView} />;
      case 'victim':
        return <VictimDashboard user={user} activeView={activeView} setActiveView={setActiveView} />;
      default:
        return <div>Unknown role</div>;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header 
        user={user} 
        onLogout={onLogout} 
        activeView={activeView} 
        setActiveView={setActiveView} 
        onSOS={() => setShowSOS(true)}
      />
      <main className="pt-16">
        {renderDashboard()}
      </main>
      <Chatbot user={user} onNavigate={setActiveView} />

      <Dialog open={showSOS} onOpenChange={setShowSOS}>
        <DialogContent className="p-0 border-none bg-transparent max-w-md w-full sm:rounded-none">
          <EmergencySOSForm onClose={() => setShowSOS(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
