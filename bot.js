const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const path = require("path");
const express = require("express");
require("dotenv").config();

const app = express();
app.use(express.json());
const port = process.env.PORT || 5000;

// Replace with your bot's API token
const token = process.env.TOKEN; // Update with your token
const bot = new TelegramBot(token); // No polling
const librarianChatId = process.env.LIBRARIAN_CHAT_ID.trim(); // Set this to the logged chat ID

// Book categories and reservations
const books = {
  Arabic: { Philosophy: [], Architecture: [] },
  Amharic: { Philosophy: [], Architecture: [] },
  AfaanOromo: { Philosophy: [], Architecture: [] },
};

let reservations = {};
let users = {};
let userLanguages = {};

// Load data from JSON files
const booksFilePath = path.join(__dirname, "books.json");
const reservationsFilePath = path.join(__dirname, "reservations.json");

function loadBooks() {
  if (fs.existsSync(booksFilePath)) {
    const data = fs.readFileSync(booksFilePath);
    return JSON.parse(data);
  }
  return {};
}

function loadReservations() {
  if (fs.existsSync(reservationsFilePath)) {
    const data = fs.readFileSync(reservationsFilePath);
    return JSON.parse(data);
  }
  return {};
}

// Load initial data
Object.assign(books, loadBooks());
Object.assign(reservations, loadReservations());

// Start command
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const welcomeMessage = `
Welcome to the Library Booking Bot!

As a librarian, you can manage book reservations.
Please register to get started by typing /register.

Available commands:
- /register: Register your name and phone number.
- /my_reservations: View your current reservations.
- /cancel_reservation [id]: Cancel your reservation by ID.
- /reserved_books: View all reserved books (librarian only).
- /add_books [language, category, title]: Add new books (librarian only).
- /reserve [book_id]: Reserve a book by its ID.
- /help: Show this help message again.
  `;
  bot.sendMessage(chatId, welcomeMessage);
});

// Registration logic
let registrationState = {};

bot.onText(/\/register/, (msg) => {
  const chatId = msg.chat.id;

  if (users[chatId]) {
    return bot.sendMessage(
      chatId,
      `You are already registered as ${users[chatId].userName}.`
    );
  }

  registrationState[chatId] = { step: 1 };
  bot.sendMessage(chatId, "Please enter your full name:");
});

// Handle user responses based on registration state
bot.on("message", (msg) => {
  const chatId = msg.chat.id;

  if (registrationState[chatId]) {
    const state = registrationState[chatId];

    if (state.step === 1) {
      state.userName = msg.text;
      state.step = 2;
      bot.sendMessage(chatId, "Please enter your phone number (numbers only):");
    } else if (state.step === 2) {
      const phoneNumber = msg.text;

      // Validate phone number
      if (!/^[0-9]+$/.test(phoneNumber)) {
        return bot.sendMessage(
          chatId,
          "Please enter a valid phone number (numbers only)."
        );
      }

      const existingUser = Object.values(users).find(
        (user) => user.phoneNumber === phoneNumber
      );
      if (existingUser) {
        delete registrationState[chatId];
        return bot.sendMessage(
          chatId,
          `This phone number is already registered by ${existingUser.userName}.`
        );
      }

      // Save user data
      users[chatId] = { userName: state.userName, phoneNumber };
      delete registrationState[chatId];

      bot.sendMessage(
        chatId,
        `Registration successful! Welcome, ${state.userName}.`
      );

      // Ask for language selection
      askLanguageSelection(chatId);
    }
  } else if (["Arabic", "Amharic", "AfaanOromo"].includes(msg.text)) {
    handleLanguageSelection(chatId, msg.text);
  } else if (msg.text === "/change_language") {
    askLanguageSelection(chatId);
  }
});

// Ask for language selection
function askLanguageSelection(chatId) {
  bot.sendMessage(chatId, "Please select a language:", {
    reply_markup: {
      keyboard: [["Arabic"], ["Amharic"], ["AfaanOromo"]],
      one_time_keyboard: true,
    },
  });
}

// Handle language selection
function handleLanguageSelection(chatId, language) {
  userLanguages[chatId] = language;

  const categories = Object.keys(books[language]);
  if (categories.length === 0) {
    return bot.sendMessage(chatId, `No categories available for ${language}.`);
  }

  bot.sendMessage(
    chatId,
    `You selected ${language}. Please choose a category:`,
    {
      reply_markup: {
        keyboard: categories.map((cat) => [cat]),
        one_time_keyboard: true,
      },
    }
  );
}

// Handle category selection and book listing
// Handle category selection and book listing
function handleCategorySelection(chatId, category) {
  const userLanguage = userLanguages[chatId];

  if (!userLanguage) {
    return bot.sendMessage(
      chatId,
      `Please select a language first by typing /register.`
    );
  }

  if (!books[userLanguage] || !books[userLanguage][category]) {
    return bot.sendMessage(
      chatId,
      `Category "${category}" does not exist under ${userLanguage}.`
    );
  }

  const availableBooks = books[userLanguage][category].filter(
    (book) => book.available
  );

  if (availableBooks.length === 0) {
    return bot.sendMessage(
      chatId,
      `No books available in ${category} under ${userLanguage}.`
    );
  }

  const bookList = availableBooks
    .map((book) => `${book.id}. ${book.title}`)
    .join("\n");

  bot.sendMessage(
    chatId,
    `Available books in ${category}:\n${bookList}\nYou can reserve a book by typing /reserve [book_id].`
  );
}

// Listen for category selection
bot.on("message", (msg) => {
  const chatId = msg.chat.id;

  if (registrationState[chatId]) {
    // ... existing registration handling
  } else if (["Arabic", "Amharic", "AfaanOromo"].includes(msg.text)) {
    handleLanguageSelection(chatId, msg.text);
  } else if (userLanguages[chatId]) {
    // Check if the message is a category selection
    if (Object.keys(books[userLanguages[chatId]]).includes(msg.text)) {
      handleCategorySelection(chatId, msg.text);
    } else {
      // If it's not a recognized category, let the user know
      bot.sendMessage(
        chatId,
        `"${msg.text}" is not a valid category. Please select a category from the available options.`
      );
    }
  } else if (msg.text === "/change_language") {
    askLanguageSelection(chatId);
  }
});
// Add multiple books
bot.onText(/\/add_books (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const booksInput = match[1].trim().split(";");

  booksInput.forEach((bookEntry) => {
    const [language, category, bookTitle] = bookEntry
      .trim()
      .split(",")
      .map((s) => s.trim());

    if (!books[language]) {
      return bot.sendMessage(chatId, `Language "${language}" does not exist.`);
    }

    if (!books[language][category]) {
      books[language][category] = [];
    }

    const newBookId = (books[language][category].length + 1)
      .toString()
      .padStart(3, "0");
    books[language][category].push({
      id: newBookId,
      title: bookTitle,
      available: true,
    });

    bot.sendMessage(
      chatId,
      `Added "${bookTitle}" to "${category}" in "${language}".`
    );
  });

  fs.writeFileSync(booksFilePath, JSON.stringify(books, null, 2));
});

// Reserve a book
// Reserve a book
// Reserve a book
bot.onText(/\/reserve (\d+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const bookId = match[1]; // Get book ID from the command
  const userLanguage = userLanguages[chatId];

  if (!userLanguage) {
    return bot.sendMessage(
      chatId,
      "You must select a language before reserving a book."
    );
  }

  let reservedBook;
  for (const category in books[userLanguage]) {
    reservedBook = books[userLanguage][category].find(
      (book) => book.id === bookId // Compare ID as string
    );
    if (reservedBook) break; // Exit loop if book is found
  }

  // Debugging: Check if the book was found
  console.log("Reserved Book:", reservedBook);

  if (!reservedBook) {
    return bot.sendMessage(chatId, `Book not available or does not exist.`);
  }

  // Check if the book is already reserved
  if (!reservedBook.available) {
    return bot.sendMessage(
      chatId,
      `This book is currently reserved. Please choose another book.`
    );
  }

  reservedBook.available = false; // Mark the book as reserved
  console.log(`Book "${reservedBook.title}" marked as reserved.`); // Debugging message

  // Initialize user's reservations if not present
  if (!reservations[chatId]) {
    reservations[chatId] = [];
  }

  // Add the reservation to the user's array
  reservations[chatId].push({
    bookId: reservedBook.id,
    bookTitle: reservedBook.title,
    userName: users[chatId].userName,
    phoneNumber: users[chatId].phoneNumber,
    pickupTime: "after isha salah",
  });

  fs.writeFileSync(reservationsFilePath, JSON.stringify(reservations, null, 2));

  bot.sendMessage(
    chatId,
    `You have successfully reserved "${reservedBook.title}". You can pick it up after isha salah.`
  );
  notifyLibrarian(
    `Book Reserved:\nName: ${users[chatId].userName}\nPhone Number: ${users[chatId].phoneNumber}\nReserved Book: ${reservedBook.title}\nPickup Time: after isha salah`
  );
});

// View own reservations
bot.onText(/\/my_reservations/, (msg) => {
  const chatId = msg.chat.id;
  const userReservations = reservations[chatId] || [];

  if (userReservations.length === 0) {
    return bot.sendMessage(chatId, `You have no reservations.`);
  }

  let response = "Your Reservations:\n";
  userReservations.forEach((reservation, index) => {
    response += `\n${index + 1}. Book Title: "${
      reservation.bookTitle
    }"\nPhone Number: ${reservation.phoneNumber}\nPickup Time: ${
      reservation.pickupTime
    }\n`;
  });

  bot.sendMessage(chatId, response);
});

// Cancel a reservation by ID
bot.onText(/\/cancel_reservation (\d+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const reservationIndex = parseInt(match[1], 10) - 1; // Convert to 0-based index

  if (!reservations[chatId] || !reservations[chatId][reservationIndex]) {
    return bot.sendMessage(chatId, "Invalid reservation ID.");
  }

  const canceledBook = reservations[chatId][reservationIndex];

  // Make the book available again
  const userLanguage = userLanguages[chatId];
  for (const category in books[userLanguage]) {
    const book = books[userLanguage][category].find(
      (b) => b.id === canceledBook.bookId
    );
    if (book) {
      book.available = true; // Mark the book as available again
      break;
    }
  }

  // Remove the reservation
  reservations[chatId].splice(reservationIndex, 1);
  fs.writeFileSync(reservationsFilePath, JSON.stringify(reservations, null, 2));

  bot.sendMessage(
    chatId,
    `You have successfully canceled the reservation for "${canceledBook.bookTitle}".`
  );
});

// Librarian command to reserve a book
bot.onText(/\/librarian_reserve (\d+) (.+) (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const bookId = match[1];
  const userName = match[2].trim().toLowerCase();
  const phoneNumber = match[3];

  let reservedBook;
  for (const language in books) {
    for (const category in books[language]) {
      reservedBook = books[language][category].find(
        (book) => book.id === bookId
      );
      if (reservedBook) break;
    }
    if (reservedBook) break;
  }

  if (!reservedBook) {
    return bot.sendMessage(chatId, `Book not available or does not exist.`);
  }

  const userChatId = Object.keys(users).find(
    (id) => users[id].userName.trim().toLowerCase() === userName
  );
  if (!userChatId) {
    return bot.sendMessage(chatId, `User "${match[2]}" not found.`);
  }

  // Initialize user's reservations if not present
  if (!reservations[userChatId]) {
    reservations[userChatId] = [];
  }

  reservations[userChatId].push({
    bookId: reservedBook.id,
    bookTitle: reservedBook.title,
    userName: users[userChatId].userName,
    phoneNumber: phoneNumber,
    pickupTime: "after isha salah",
  });

  reservedBook.available = false; // Mark book as reserved

  fs.writeFileSync(reservationsFilePath, JSON.stringify(reservations, null, 2));

  bot.sendMessage(
    librarianChatId,
    `Librarian reserved "${reservedBook.title}" for "${users[userChatId].userName}".`
  );
  bot.sendMessage(
    userChatId,
    `You have reserved "${reservedBook.title}" by librarian.`
  );
});

// View all reserved books
bot.onText(/\/reserved_books/, (msg) => {
  const chatId = msg.chat.id.toString();
  const librarianChatIdStr = librarianChatId.toString().trim();

  if (chatId !== librarianChatIdStr) {
    return bot.sendMessage(
      chatId,
      `You do not have permission to view reserved books.`
    );
  }

  const allReservations = Object.entries(reservations);
  if (allReservations.length === 0) {
    return bot.sendMessage(chatId, `No valid reservations found.`);
  }

  const reservedList = allReservations
    .map(([userId, userReservations]) => {
      const user = users[userId];
      return userReservations
        .map((reservation) => {
          return `Name: ${user.userName}, Reserved Book: ${reservation.bookTitle}, Phone Number: ${reservation.phoneNumber}`;
        })
        .join("\n");
    })
    .flat()
    .filter((item) => item !== null);

  if (reservedList.length === 0) {
    return bot.sendMessage(chatId, `No valid reservations found.`);
  }

  bot.sendMessage(chatId, `Reserved Books:\n${reservedList.join("\n")}`);
});

// Helper function to notify the librarian
function notifyLibrarian(message) {
  bot.sendMessage(librarianChatId, message);
}

// Error handling for polling
bot.on("polling_error", (error) => {
  console.error("Polling error:", error);
});

bot.on("error", (error) => {
  console.error("Error occurred:", error);
});

// Set the webhook URL
const setWebhook = async () => {
  const url = `https://librarybot-qx3c.onrender.com/webhook`; // Replace with your actual URL
  await bot.setWebHook(url);
};

app.post("/webhook", (req, res) => {
  console.log("Webhook received:", req.body); // Log incoming updates
  bot.processUpdate(req.body);
  res.sendStatus(200); // Respond with a 200 OK
});
setWebhook().catch(console.error);

// Start the Express server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
