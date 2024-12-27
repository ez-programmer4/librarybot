const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  userName: String,
  phoneNumber: String,
});

const bookSchema = new mongoose.Schema({
  id: Number,
  title: String,
  available: Boolean,
  language: String,
  category: String,
});

const reservationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  bookId: { type: mongoose.Schema.Types.ObjectId, ref: "Book" },
  pickupTime: String,
});

const User = mongoose.model("User", userSchema);
const Book = mongoose.model("Book", bookSchema);
const Reservation = mongoose.model("Reservation", reservationSchema);

module.exports = { User, Book, Reservation };
