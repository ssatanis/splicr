
import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const SUAPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || 'SplicR <notifications@splicr.org>';

if (!SUAPA_URL || !SERVICE_KEY) {
    console.error('Missing Supabase credentials in .env.local');
    process.exit(1);
}

if (!RESEND_KEY) {
    console.error('Missing Resend API key in .env.local');
    process.exit(1);
}

const supabase = createClient(SUAPA_URL, SERVICE_KEY, {
    auth: {
        autoRefreshToken: false,
        persistSession: false,
    },
});

const resend = new Resend(RESEND_KEY);

const TEST_EMAIL = process.argv[2] || 'test-splicr-reset-v2@example.com';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const REDIRECT_TO = `${APP_URL}/auth/reset-password`;

async function main() {
    console.log('Testing Resend Email Sending...');
    console.log(`Target Email: ${TEST_EMAIL}`);
    // console.log(`Supabase URL: ${SUAPA_URL}`);
    // console.log(`Redirect To: ${REDIRECT_TO}`);

    // // 0. Check if user exists
    // console.log('\n0. Checking User Existence...');
    // const { data: listData, error: listError } = await supabase.auth.admin.listUsers();

    // if (listError) {
    //     console.error('❌ Failed to list users:', listError);
    //     return;
    // }

    // console.log(`Found ${listData.users.length} users.`);
    // console.log('Users:', listData.users.map(u => u.email));

    // const existingUser = listData.users.find(u => u.email === TEST_EMAIL);
    // if (!existingUser) {
    //     console.log(`User ${TEST_EMAIL} not found. Creating...`);
    //     const { data: createData, error: createError } = await supabase.auth.admin.createUser({
    //         email: TEST_EMAIL,
    //         password: 'TemporaryPassword123!',
    //         email_confirm: true
    //     });

    //     if (createError) {
    //         console.error('❌ Failed to create user:', createError);
    //         return;
    //     }
    //     console.log('✅ User created successfully.');
    // } else {
    //     console.log('✅ User exists.');
    // }

    // // 1. Generate Link
    // console.log('\n1. Generating Password Reset Link...');
    // const { data, error } = await supabase.auth.admin.generateLink({
    //     type: 'recovery',
    //     email: TEST_EMAIL,
    //     options: {
    //         redirectTo: REDIRECT_TO,
    //     },
    // });

    // if (error) {
    //     console.error('❌ Failed to generate link:', error);
    //     return;
    // }

    // const actionLink = data?.properties?.action_link;
    // if (!actionLink) {
    //     console.error('❌ No action link returned');
    //     // Log the whole data object to see what's wrong
    //     console.log('Full response data:', JSON.stringify(data, null, 2));
    //     return;
    // }

    // console.log('✅ Link generated successfully!');
    // console.log('Action Link:', actionLink);

    // // 2. Send Email
    // console.log('\n2. Sending Email via Resend... (SKIPPED FOR SAFETY)');
    // const resetUrl = actionLink;

    try {
        const { data: emailData, error: emailError } = await resend.emails.send({
            from: RESEND_FROM,
            to: TEST_EMAIL,
            subject: 'SplicR Test Email',
            html: `<p>This is a test email from SplicR script to verify Resend configuration.</p>`,
        });

        if (emailError) {
            console.error('❌ Failed to send email:', emailError);
            console.error('Full Error:', JSON.stringify(emailError, null, 2));
        } else {
            console.log('✅ Email sent successfully!');
            console.log('Email ID:', emailData?.id);
        }

    } catch (err) {
        console.error('❌ Exception sending email:', err);
    }
}

main();
