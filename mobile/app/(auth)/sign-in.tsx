// mobile/app/(auth)/sign-in.tsx

import { useState } from 'react';
import { View, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { supabase } from '../../lib/supabase';

export default function SignInScreen() {
    const [signingIn, setSigningIn] = useState(false);

    async function handleAppleSignIn() {
        setSigningIn(true);
        try {
            // Standard OIDC nonce pattern: the RAW nonce goes to Supabase for verification;
            // Apple only ever sees its SHA-256 HASH, embedded into the identity token it
            // signs. Passing the same raw value to both sides would skip the point of a
            // nonce entirely — this is the one place a shortcut here is a real security gap,
            // not just untidy code.
            const rawNonce = Crypto.randomUUID();
            const hashedNonce = await Crypto.digestStringAsync(
                Crypto.CryptoDigestAlgorithm.SHA256,
                rawNonce
            );

            const credential = await AppleAuthentication.signInAsync({
                requestedScopes: [
                    AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
                    AppleAuthentication.AppleAuthenticationScope.EMAIL,
                ],
                nonce: hashedNonce,
            });

            if (!credential.identityToken) {
                throw new Error('Apple did not return an identity token.');
            }

            const { error } = await supabase.auth.signInWithIdToken({
                provider: 'apple',
                token: credential.identityToken,
                nonce: rawNonce,
            });

            if (error) throw error;

            // Apple sends the user's name on this exact authorization only — every sign-in
            // after this one returns null for it, permanently, unless the user later revokes
            // and re-grants access. Capture and persist it now or it's gone for good.
            if (credential.fullName?.givenName || credential.fullName?.familyName) {
                const fullName = [credential.fullName.givenName, credential.fullName.familyName]
                    .filter(Boolean)
                    .join(' ');

                await supabase.auth.updateUser({
                    data: {
                        full_name: fullName,
                        given_name: credential.fullName.givenName,
                        family_name: credential.fullName.familyName,
                    },
                });
            }

            router.replace('/map');
        } catch (e: any) {
            if (e.code === 'ERR_REQUEST_CANCELED') {
                return; // user dismissed the sheet — not a real error
            }
            Alert.alert('Sign in failed', e.message ?? 'Please try again.');
        } finally {
            setSigningIn(false);
        }
    }

    return (
        <View style={styles.container}>
            {signingIn ? (
                <ActivityIndicator size="large" />
            ) : (
                <AppleAuthentication.AppleAuthenticationButton
                    buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                    buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                    cornerRadius={8}
                    style={styles.button}
                    onPress={handleAppleSignIn}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
    button: { width: 260, height: 48 },
});