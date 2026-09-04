import { Ionicons } from '@expo/vector-icons';
import React, { useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { request } from '../../services/api';

export default function AssistantScreen() {
    const { token } = useAuth();
    const [messages, setMessages] = useState<{ id: string, text: string, sender: 'user' | 'ai' }[]>([{
        id: 'welcome',
        text: 'Bonjour ! Je suis Montia, votre assistant IA Mongain (V9).\n\nPosez-moi une question sur votre solde, vos cryptos ou vos cartes !',
        sender: 'ai'
    }]);
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const scrollViewRef = useRef<ScrollView>(null);

    const sendMessage = async () => {
        const text = input.trim();
        if (!text) return;

        const userMsgId = Date.now().toString();
        setMessages(prev => [...prev, { id: userMsgId, text, sender: 'user' }]);
        setInput('');
        setIsTyping(true);

        try {
            const res = await request('POST', '/api/ai/chat', { message: text }, true);
            setMessages(prev => [...prev, { id: Date.now().toString() + 'ai', text: res.reply, sender: 'ai' }]);
        } catch (e: any) {
            setMessages(prev => [...prev, { id: Date.now().toString() + 'err', text: "Désolé, j'ai rencontré une erreur de connexion au réseau neural Mongain.", sender: 'ai' }]);
        } finally {
            setIsTyping(false);
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                keyboardVerticalOffset={90}
            >
                <View style={styles.header}>
                    <Text style={styles.title}>Assistant IA</Text>
                    <View style={styles.statusBadge}>
                        <View style={styles.statusDot} />
                        <Text style={styles.statusText}>En ligne</Text>
                    </View>
                </View>

                <ScrollView
                    ref={scrollViewRef}
                    contentContainerStyle={styles.chatScroll}
                    onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
                >
                    {messages.map(msg => (
                        <View key={msg.id} style={[styles.messageBubble, msg.sender === 'user' ? styles.userBubble : styles.aiBubble]}>
                            {msg.sender === 'ai' && (
                                <Ionicons name="scan-outline" color="#A855F7" size={18} style={{ marginRight: 8, marginTop: 2 }} />
                            )}
                            <Text style={msg.sender === 'user' ? styles.userText : styles.aiText}>
                                {msg.text}
                            </Text>
                        </View>
                    ))}
                    {isTyping && (
                        <View style={[styles.messageBubble, styles.aiBubble, { width: 80, justifyContent: 'center' }]}>
                            <ActivityIndicator size="small" color="#A855F7" />
                        </View>
                    )}
                </ScrollView>

                <View style={styles.inputArea}>
                    <TextInput
                        style={styles.input}
                        placeholder="Posez votre question..."
                        placeholderTextColor="#94A3B8"
                        value={input}
                        onChangeText={setInput}
                        onSubmitEditing={sendMessage}
                    />
                    <TouchableOpacity style={styles.sendBtn} onPress={sendMessage}>
                        <Ionicons name="send" color="#fff" size={20} />
                    </TouchableOpacity>
                </View>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0f172a' },
    header: { paddingHorizontal: 24, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    title: { color: '#ffffff', fontSize: 22, fontFamily: 'Satoshi-SemiBold', fontWeight: '800' },
    statusBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(16, 185, 129, 0.1)', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
    statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#10B981', marginRight: 6 },
    statusText: { color: '#10B981', fontSize: 12, fontFamily: 'Satoshi-SemiBold', fontWeight: '700' },
    chatScroll: { padding: 24, gap: 16 },
    messageBubble: { maxWidth: '85%', padding: 16, borderRadius: 20, flexDirection: 'row' },
    userBubble: { backgroundColor: '#3B82F6', alignSelf: 'flex-end', borderBottomRightRadius: 4 },
    aiBubble: { backgroundColor: 'rgba(255,255,255,0.05)', alignSelf: 'flex-start', borderBottomLeftRadius: 4, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
    userText: { color: '#fff', fontSize: 15, lineHeight: 22 },
    aiText: { color: '#E2E8F0', fontSize: 15, lineHeight: 22, flexShrink: 1 },
    inputArea: { flexDirection: 'row', padding: 24, paddingBottom: Platform.OS === 'ios' ? 40 : 24, backgroundColor: 'rgba(0,0,0,0.2)', alignItems: 'center', gap: 12 },
    input: { flex: 1, backgroundColor: 'rgba(255,255,255,0.05)', color: '#fff', paddingHorizontal: 20, paddingVertical: 14, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', fontSize: 15 },
    sendBtn: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#A855F7', justifyContent: 'center', alignItems: 'center', shadowColor: '#A855F7', shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }
});

