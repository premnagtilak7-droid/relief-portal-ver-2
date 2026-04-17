import React, { useState, useEffect, useRef } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { AlertCircle, MapPin, Phone, MessageSquare, Camera, Send, X, Loader2 } from 'lucide-react';
import { getCurrentLocation, subscribeToNearbyVolunteers, NearbyVolunteer } from '@/lib/geolocation';
import { submitSOS } from '@/lib/alerts';
import { analyzeBase64Photo } from '@/lib/gemini';
import { toast } from 'sonner';

const HELPLINE_MAPPING: Record<string, string> = {
  'Fire Department': '101',
  'Medical Center': '102',
  'Coast Guard': '1091',
  'Police Station': '100',
  'Relief Hub': '112',
  'fallback': '112'
};

interface EmergencySOSFormProps {
  onClose: () => void;
}

export function EmergencySOSForm({ onClose }: EmergencySOSFormProps) {
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [isLocating, setIsLocating] = useState(true);
  const [photo, setPhoto] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [nearbyVolunteers, setNearbyVolunteers] = useState<NearbyVolunteer[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    fetchLocation();
    return () => stopCamera();
  }, []);

  useEffect(() => {
    if (!location) return;

    const unsubscribe = subscribeToNearbyVolunteers(
      location.lat,
      location.lng,
      5, // 5km radius for SOS
      (volunteers) => setNearbyVolunteers(volunteers)
    );

    return () => unsubscribe();
  }, [location]);

  const fetchLocation = async () => {
    setIsLocating(true);
    try {
      const coords = await getCurrentLocation();
      setLocation({ lat: coords.latitude, lng: coords.longitude });
    } catch (error) {
      toast.error('Could not get precise location. You can still send the SOS.');
    } finally {
      setIsLocating(false);
    }
  };

  const startCamera = async () => {
    setIsCapturing(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error('Camera access error:', err);
      toast.error('Could not access camera.');
      setIsCapturing(false);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsCapturing(false);
  };

  const takePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      if (context) {
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
        context.drawImage(videoRef.current, 0, 0);
        const dataUrl = canvasRef.current.toDataURL('image/jpeg');
        setPhoto(dataUrl);
        stopCamera();
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone) {
      toast.error('Phone number is required');
      return;
    }

    setIsSubmitting(true);
    try {
      let analysis = undefined;
      let photoURL = null;
      
      if (photo) {
        const base64Data = photo.split(',')[1];
        toast.info('Analyzing emergency photo...', { id: 'analyzing' });
        analysis = await analyzeBase64Photo(base64Data);
        toast.dismiss('analyzing');
        photoURL = photo; 
      }

      const sosData = {
        name: 'Emergency SOS User',
        phone,
        location: location ? `${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}` : 'Location unknown',
        emergencyType: analysis?.primaryNeed || 'Urgent',
        description: message || 'Urgent assistance required via SOS',
        latitude: location?.lat,
        longitude: location?.lng,
        photoURL,
        targetStation: analysis?.targetStation,
        visionAnalysis: analysis
      };

      await submitSOS(sosData);

      // --- AUTO CALL & MESSAGE LOGIC (Twilio) ---
      const recipientNumber = nearbyVolunteers.length > 0 
        ? nearbyVolunteers[0].phoneNumber 
        : (HELPLINE_MAPPING[analysis?.targetStation || 'fallback'] || '112');

      const emoji = analysis?.primaryNeed === 'Medical' ? '🚑' : analysis?.primaryNeed === 'Fire' ? '🚒' : '🚨';
      const smsBody = `${emoji} EMERGENCY SOS!\nNeed: ${sosData.emergencyType}\nPos: ${sosData.location}\nDetails: ${sosData.description}`;

      // Twilio cannot call/text short codes (e.g., 100, 101, 112). 
      // We detect these and bypass the server API.
      const isShortCode = recipientNumber.replace(/\D/g, '').length < 7;

      if (isShortCode) {
        toast.success(`SOS BROADCASTED!`, {
          description: `Directly connecting you to ${analysis?.targetStation || 'Emergency Services'}...`,
        });
        setTimeout(() => {
          window.open(`tel:${recipientNumber}`);
        }, 1000);
      } else {
        toast.promise(
          fetch('/api/emergency/sos-broadcast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              recipientNumber,
              message: smsBody,
              type: sosData.emergencyType
            })
          }).then(async (res) => {
            if (!res.ok) {
              const err = await res.json();
              throw new Error(err.error || 'Twilio server error');
            }
            return res.json();
          }),
          {
            loading: 'Initializing automated rescue call...',
            success: (data) => {
              return `Rescue call & SMS initiated! (SID: ${data.callSid.slice(-4)})`;
            },
            error: (err) => {
              console.warn('Twilio failed, falling back to manual dial:', err);
              // Fallback to client-side trigger
              setTimeout(() => {
                window.open(`tel:${recipientNumber}`);
              }, 500);
              return 'Twilio call failed. Opening phone dialer instead...';
            }
          }
        );
      }

      onClose();
    } catch (error: any) {
      toast.error('Failed to send SOS: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto shadow-2xl border-red-100 dark:border-red-900 overflow-hidden animate-in fade-in zoom-in duration-300">
      <CardHeader className="bg-red-50 dark:bg-red-950/20 text-center relative border-b border-red-100 dark:border-red-900">
        <Button 
          variant="ghost" 
          size="icon" 
          className="absolute right-4 top-4 hover:bg-red-100 dark:hover:bg-red-900/40"
          onClick={onClose}
        >
          <X className="h-5 w-5" />
        </Button>
        <div className="flex justify-center mb-2">
          <div className="bg-red-100 dark:bg-red-900/40 p-3 rounded-full">
            <AlertCircle className="h-8 w-8 text-red-600 dark:text-red-400 animate-pulse" />
          </div>
        </div>
        <CardTitle className="text-2xl font-bold text-red-600 dark:text-red-400">Emergency SOS</CardTitle>
        <p className="text-sm text-red-800/70 dark:text-red-300/70">
          Send your location immediately. Help will be dispatched.
        </p>
      </CardHeader>

      <CardContent className="p-6 space-y-5">
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Location Section */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2 text-sm font-semibold">
              <MapPin className="h-4 w-4 text-blue-600" />
              Location
            </Label>
            <div className={`p-3 rounded-lg border text-sm flex items-center justify-center gap-2 ${
              isLocating ? 'bg-blue-50/50 border-blue-200 animate-pulse' : 'bg-muted/30 border-border'
            }`}>
              {isLocating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                  <span className="text-blue-600 font-medium">Getting Location...</span>
                </>
              ) : location ? (
                <span className="font-mono text-xs">{location.lat.toFixed(6)}, {location.lng.toFixed(6)}</span>
              ) : (
                <span className="text-destructive">Location access denied</span>
              )}
            </div>
          </div>

          {/* Phone Section */}
          <div className="space-y-2">
            <Label htmlFor="sos-phone" className="flex items-center gap-2 text-sm font-semibold">
              <Phone className="h-4 w-4 text-blue-600" />
              Phone Number <span className="text-red-500">*</span>
            </Label>
            <Input
              id="sos-phone"
              type="tel"
              placeholder="Enter your phone number"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              className="bg-muted/20"
            />
          </div>

          {/* Message Section */}
          <div className="space-y-2">
            <Label htmlFor="sos-message" className="flex items-center gap-2 text-sm font-semibold">
              <MessageSquare className="h-4 w-4 text-blue-600" />
              Help Message
            </Label>
            <Textarea
              id="sos-message"
              placeholder="Describe your emergency situation..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              className="bg-muted/20 resize-none"
            />
          </div>

          {/* Photo Section */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2 text-sm font-semibold">
              <Camera className="h-4 w-4 text-blue-600" />
              Photo (Optional)
            </Label>
            
            {!isCapturing && !photo && (
              <Button 
                type="button" 
                variant="outline" 
                className="w-full border-dashed"
                onClick={startCamera}
              >
                <Camera className="mr-2 h-4 w-4" />
                Snap Photo
              </Button>
            )}

            {isCapturing && !photo && (
              <div className="relative rounded-lg overflow-hidden bg-black aspect-video flex items-center justify-center">
                <video 
                  ref={videoRef} 
                  autoPlay 
                  playsInline 
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-4 flex gap-2">
                  <Button type="button" size="sm" onClick={takePhoto} className="rounded-full h-12 w-12 bg-white text-black hover:bg-white/90">
                    <Camera className="h-6 w-6" />
                  </Button>
                  <Button type="button" size="sm" variant="destructive" onClick={stopCamera} className="rounded-full h-12 w-12">
                    <X className="h-6 w-6" />
                  </Button>
                </div>
              </div>
            )}

            {photo && (
              <div className="relative rounded-lg overflow-hidden group">
                <img src={photo} alt="Snapped" className="w-full h-auto" />
                <Button 
                  type="button" 
                  variant="destructive" 
                  size="icon" 
                  className="absolute top-2 right-2 h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => setPhoto(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}

            <canvas ref={canvasRef} className="hidden" />
          </div>

          <Button 
            type="submit" 
            disabled={isSubmitting}
            className="w-full bg-red-600 hover:bg-red-700 text-white py-6 text-lg font-bold uppercase tracking-wider shadow-lg shadow-red-200 dark:shadow-none"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                BROADCASTING...
              </>
            ) : (
              <>
                <AlertCircle className="mr-2 h-5 w-5" />
                SEND EMERGENCY SOS
              </>
            )}
          </Button>

          <div className="pt-4 border-t border-border flex flex-col items-center gap-2">
            <span className="text-xs text-muted-foreground">For immediate help, call:</span>
            <a href="tel:112" className="flex items-center gap-2 text-red-600 font-bold text-lg hover:underline transition-all">
              <Phone className="h-5 w-5" />
              112 (Emergency)
            </a>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
