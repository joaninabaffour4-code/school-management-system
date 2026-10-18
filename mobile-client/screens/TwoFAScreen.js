import React, { useState } from 'react';
import { View, TextInput, Button, Text, StyleSheet } from 'react-native';
import { getServerUrl } from '../apiConfig';

export default function TwoFAScreen({ tempToken, onSuccess, onCancel }) {
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function verify() {
    if (!code || code.trim().length !== 6) {
      setMessage('Please enter a valid 6-digit code from your authenticator app.');
      return;
    }

    setLoading(true);
    setMessage('');

    try {
      const serverUrl = getServerUrl();
      const res = await fetch(`${serverUrl}/api/auth/2fa/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tempToken, code: code.trim() }),
      });

      const body = await res.json();
      setLoading(false);

      if (!res.ok) {
        setMessage(body.message || body.error || '2FA verification failed.');
        return;
      }

      onSuccess(body.token || body.accessToken, body.user);
    } catch (err) {
      setLoading(false);
      setMessage(`Connection Error: ${err.message}`);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🔒 Two-Factor Verification</Text>
      <Text style={styles.subtitle}>Enter the 6-digit one-time code from your Google Authenticator or Microsoft Authenticator app.</Text>

      <TextInput
        placeholder="123456"
        value={code}
        onChangeText={setCode}
        style={styles.input}
        keyboardType="numeric"
        maxLength={6}
        autoFocus
      />

      <Button
        title={loading ? 'Verifying Code...' : 'Verify & Continue'}
        onPress={verify}
        disabled={loading}
        color="#1e3a8a"
      />

      {onCancel && (
        <View style={{ marginTop: 10 }}>
          <Button title="Back to Login" onPress={onCancel} color="#64748b" />
        </View>
      )}

      {message ? <Text style={styles.error}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, flex: 1, justifyContent: 'center', backgroundColor: '#f8fafc' },
  title: { fontSize: 22, fontWeight: 'bold', color: '#1e3a8a', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 13, color: '#64748b', textAlign: 'center', marginBottom: 24, lineHeight: 18 },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, padding: 14, fontSize: 24, textAlign: 'center', letterSpacing: 8, backgroundColor: '#fff', marginBottom: 16 },
  error: { color: '#dc2626', marginTop: 12, backgroundColor: '#fee2e2', padding: 10, borderRadius: 6, fontSize: 13, textAlign: 'center' },
});
