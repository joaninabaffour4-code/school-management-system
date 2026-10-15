import React, { useState } from 'react';
import { View, TextInput, Button, Text, StyleSheet } from 'react-native';

export default function RegisterScreen({ onDone }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');

  async function doRegister() {
    try {
      const res = await fetch('http://10.0.2.2:4000/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password })
      });
      const body = await res.json();
      if (!res.ok) { setMessage(body.error || 'Register failed'); return; }
      setMessage('Registered. You can now log in.');
      setTimeout(() => onDone(), 1500);
    } catch (err) { setMessage(err.message); }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Register</Text>
      <TextInput placeholder="Name" value={name} onChangeText={setName} style={styles.input} />
      <TextInput placeholder="Email" value={email} onChangeText={setEmail} style={styles.input} />
      <TextInput placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} style={styles.input} />
      <Button title="Register" onPress={doRegister} />
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  input: { borderWidth: 1, marginBottom: 8, padding: 8 },
  title: { fontSize: 18, marginBottom: 12 },
  message: { marginTop: 8 }
});
