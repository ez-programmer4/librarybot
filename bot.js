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
const bot = new TelegramBot(token, { polling: true });

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
- /cancel: Cancel your reservation.
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
  } else {
    handleCategorySelection(chatId, msg.text);
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

    const newBookId = books[language][category].length + 1;
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
bot.onText(/\/reserve (\d+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const bookId = parseInt(match[1], 10);
  const userLanguage = userLanguages[chatId];

  let reservedBook;
  for (const category in books[userLanguage]) {
    reservedBook = books[userLanguage][category].find(
      (book) => book.id === bookId
    );
    if (reservedBook) break;
  }

  if (!reservedBook) {
    return bot.sendMessage(chatId, `Book not available or does not exist.`);
  }

  if (!users[chatId]) {
    return bot.sendMessage(
      chatId,
      "You must register before reserving a book. Please type /register."
    );
  }

  if (!reservedBook.available) {
    return bot.sendMessage(
      chatId,
      `This book is currently reserved. Please choose another book.`
    );
  }

  reservedBook.available = false;
  reservations[chatId] = {
    bookId: reservedBook.id,
    bookTitle: reservedBook.title,
    userName: users[chatId].userName,
    phoneNumber: users[chatId].phoneNumber,
  };

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
  const userReservation = reservations[chatId];

  if (!userReservation) {
    return bot.sendMessage(chatId, `You have no reservations.`);
  }

  const reservationDetails = `
Your Reservation:
- Book Title: ${userReservation.bookTitle}
- Phone Number: ${userReservation.phoneNumber}
- Pickup Time: 3 o'clock
  `;
  bot.sendMessage(chatId, reservationDetails);
});

// Cancel a reservation
bot.onText(/\/cancel/, (msg) => {
  const chatId = msg.chat.id;
  const reservation = reservations[chatId];

  if (!reservation) {
    return bot.sendMessage(chatId, `You have no reservations.`);
  }

  const book = findBookById(reservation.bookId);
  if (book) {
    book.available = true;
    delete reservations[chatId];

    fs.writeFileSync(
      reservationsFilePath,
      JSON.stringify(reservations, null, 2)
    );

    bot.sendMessage(
      chatId,
      `Your reservation for "${book.title}" has been canceled.`
    );
    notifyLibrarian(
      `Reservation Canceled:\nName: ${users[chatId].userName}\nPhone Number: ${users[chatId].phoneNumber}\nCanceled Book: ${book.title}`
    );
  }
});

// Helper function to find a book by its ID
function findBookById(bookId) {
  return Object.values(books)
    .flatMap((lang) => Object.values(lang))
    .flat()
    .find((book) => book.id === bookId);
}

// Librarian command to reserve a book
bot.onText(/\/librarian_reserve (\d+) (.+) (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const bookId = parseInt(match[1], 10);
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

  reservations[userChatId] = {
    bookId: reservedBook.id,
    bookTitle: reservedBook.title,
    userName: users[userChatId].userName,
    phoneNumber: phoneNumber,
  };

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
    .map(([userId, reservation]) => {
      const user = users[userId];
      if (user) {
        return `Name: ${user.userName}, Reserved Book: ${reservation.bookTitle}, Phone Number: ${reservation.phoneNumber}`;
      }
      return null;
    })
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

// Start the Express server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
